/** Wires the workspace, the board and the chrome around them together. */
import { State, createDevice, deviceKindFromUrl } from '../device/device-target.js'
// Each import registers a kind of device. Add a simulator the same way.
import '../device/device-manager.js'
import '../device/loopback-device.js'
import { SUPPORTED_TARGETS, getTarget } from '../device/targets.js'
import { BlockWorkspace, STARTER_PROJECTS, DEFAULT_PROJECT_NAME, fileNameFor } from '../workspace/workspace.js'
import { generatePython, highlightPython, devicesUsed } from '../blocks/index.js'
import { TerminalPanel } from './terminal.js'
import { toast, showModal } from './notify.js'
import { t, listOf } from '../i18n/index.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1'
const PICKED_DEVICE = 'opencodebot.device.v1'

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    this.device = createDevice(deviceKindFromUrl())
    this.pickedTarget = localStorage.getItem(PICKED_DEVICE) || null

    this.workspace = new BlockWorkspace($('blockly-root'), this.pickedTarget)
    this.terminal = new TerminalPanel($('terminal-host'), (data) => this.device.sendRaw(data))

    this._bindDevice()
    this._bindChrome()
    this._bindWorkspace()

    if (!this.workspace.restore() && this.pickedTarget) {
      this.workspace.loadProject(STARTER_PROJECTS[this.pickedTarget] || { blocks: {} })
    }

    this._greet()
    this._renderDevicePicker()
    this._refreshDeviceChip()
    this._refreshPython()
    this._checkBrowser()
    this._maybeWelcome()

    // A board that is already plugged in and paired can just come back.
    this.device.autoConnect?.().catch(() => {})
  }

  _greet() {
    this.terminal.write(`\x1b[32m${t('term.greeting')}\x1b[0m\r\n\x1b[90m${t('term.greetingHint')}\x1b[0m\r\n`)
  }

  // ------------------------------------------------------------- device

  _bindDevice() {
    const device = this.device

    device.addEventListener('data', (e) => this.terminal.write(e.detail))

    device.addEventListener('state', (e) => {
      const { state, message } = e.detail
      this._setStatus(state, message)
      this._refreshButtons()
      this._refreshDeviceChip()
    })

    device.addEventListener('device', (e) => {
      const { targetId, target, firmware } = e.detail
      if (targetId && target?.supported) {
        this._adoptConnectedTarget(targetId)
        if (firmware) {
          this.terminal.say(t('term.connected', { device: target.name, version: firmware.version, date: firmware.date }))
        }
      }
      this._refreshDeviceChip()
      this._refreshButtons()
    })

    device.addEventListener('notice', (e) => toast(e.detail))

    device.addEventListener('program-error', (e) => {
      const { name, message, line } = e.detail
      toast({
        kind: 'error',
        title: friendlyErrorTitle(name),
        detail: [message, line ? t('error.atLine', { line }) : ''].filter(Boolean).join(' '),
      })
      this._setStatus('error', t('status.programError', { name, message }))
    })

    device.addEventListener('progress', (e) => {
      const pct = Math.round(e.detail * 100)
      this._setStatus(State.LOADING, t('status.sendingPct', { pct }))
    })
  }

  /** When a real board shows up, follow it — that is what the student has. */
  _adoptConnectedTarget(targetId) {
    if (this.workspace.targetId === targetId) return
    const used = devicesUsed(this.workspace.workspace)
    const conflicting = [...used].filter((id) => id !== targetId)
    this.workspace.setTarget(targetId)
    this.pickedTarget = targetId
    localStorage.setItem(PICKED_DEVICE, targetId)
    this._renderDevicePicker()

    const device = getTarget(targetId)?.name
    if (conflicting.length) {
      toast({
        kind: 'warn',
        title: t('switched.title', { device }),
        detail: t('switched.detail', { names: deviceNames(conflicting) }),
      })
    } else if (this.workspace.isEmpty) {
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
      toast({ kind: 'info', title: t('adopted.readyTitle', { device }), detail: t('adopted.readyDetail') })
    } else {
      toast({ kind: 'info', title: t('adopted.connectedTitle', { device }), detail: t('adopted.connectedDetail') })
    }
  }

  async _toggleConnect() {
    if (this.device.isConnected) {
      await this.device.disconnect()
      this.terminal.warn(t('term.disconnected'))
      return
    }
    const ok = await this.device.connect()
    if (ok) this.terminal.focus()
  }

  async _run() {
    if (this.workspace.isEmpty) {
      toast({ kind: 'warn', title: t('run.emptyTitle'), detail: t('run.emptyDetail') })
      return
    }
    const target = this.device.targetId
    const used = devicesUsed(this.workspace.workspace)
    const wrong = [...used].filter((id) => id !== target)
    if (target && wrong.length) {
      toast({
        kind: 'warn',
        title: t('run.wrongTitle'),
        detail: t('run.wrongDetail', { names: deviceNames(wrong), device: getTarget(target)?.name }),
      })
      return
    }

    const code = this._currentPython()
    this.terminal.say(t('term.sending'))
    await this.device.run(code)
  }

  async _stop() {
    await this.device.stop()
  }

  // ------------------------------------------------------------ chrome

  _bindChrome() {
    $('btn-connect').addEventListener('click', () => this._toggleConnect())
    $('btn-run').addEventListener('click', () => this._run())
    $('btn-stop').addEventListener('click', () => this._stop())
    $('btn-clear-term').addEventListener('click', () => this.terminal.clear())
    $('btn-new').addEventListener('click', () => this._newProject())

    // Project name: edit in place. Enter or leaving the field saves it,
    // Escape puts the old name back.
    const nameField = $('project-name')
    nameField.value = this.workspace.name
    nameField.addEventListener('change', () => {
      this.workspace.rename(nameField.value)
      nameField.value = this.workspace.name
    })
    nameField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameField.blur()
      if (e.key === 'Escape') {
        nameField.value = this.workspace.name
        nameField.blur()
      }
    })
    this.workspace.addEventListener('rename', () => {
      nameField.value = this.workspace.name
      document.title = t('project.pageTitle', { name: this.workspace.name })
    })

    // Tabs
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => this._selectTab(tab.dataset.tab))
    }

    // Device picker
    const chip = $('device-chip')
    const menu = $('device-menu')
    chip.addEventListener('click', () => this._togglePopover(chip, menu))

    // Overflow menu
    const menuBtn = $('btn-menu')
    const appMenu = $('app-menu')
    menuBtn.addEventListener('click', () => this._togglePopover(menuBtn, appMenu))
    appMenu.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action
      if (!action) return
      this._togglePopover(menuBtn, appMenu, false)
      this._menuAction(action)
    })

    document.addEventListener('click', (e) => {
      if (!chip.contains(e.target) && !menu.contains(e.target)) this._togglePopover(chip, menu, false)
      if (!menuBtn.contains(e.target) && !appMenu.contains(e.target)) {
        this._togglePopover(menuBtn, appMenu, false)
      }
    })

    $('file-input').addEventListener('change', (e) => this._openFile(e.target.files?.[0]))

    document.addEventListener('keydown', (e) => {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        this._run()
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        this._saveFile()
      } else if (e.key === 'Escape' && this.device.state === State.RUNNING) {
        this._stop()
      }
    })

    this._bindSplitter()
    window.addEventListener('resize', () => {
      this.workspace.resize()
      this.terminal.resize()
    })
  }

  _togglePopover(button, panel, force) {
    const open = force ?? panel.hidden
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  _selectTab(name) {
    for (const tab of document.querySelectorAll('.tab')) {
      const active = tab.dataset.tab === name
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', String(active))
    }
    for (const panel of document.querySelectorAll('.tab-panel')) {
      panel.classList.toggle('is-active', panel.dataset.panel === name)
    }
    if (name === 'terminal') {
      this.terminal.resize()
      this.terminal.focus()
    }
  }

  _bindSplitter() {
    const splitter = $('splitter')
    const workarea = document.querySelector('.workarea')
    let dragging = false

    const apply = (event) => {
      const rect = workarea.getBoundingClientRect()
      const vertical = window.matchMedia('(max-width: 880px)').matches
      if (vertical) {
        const height = Math.min(Math.max(rect.bottom - event.clientY, 120), rect.height - 140)
        workarea.style.gridTemplateRows = `1fr 6px ${height}px`
      } else {
        const width = Math.min(Math.max(rect.right - event.clientX, 220), rect.width - 280)
        workarea.style.setProperty('--side-w', `${width}px`)
      }
      this.workspace.resize()
      this.terminal.resize()
    }

    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      splitter.setPointerCapture(e.pointerId)
    })
    splitter.addEventListener('pointermove', (e) => dragging && apply(e))
    splitter.addEventListener('pointerup', () => {
      dragging = false
    })
  }

  // -------------------------------------------------------- device chip

  _renderDevicePicker() {
    const menu = $('device-menu')
    menu.innerHTML = '<div class="dm-head"></div>'
    menu.firstChild.textContent = t('chip.menuHead')
    for (const target of SUPPORTED_TARGETS) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(target.id === this.workspace.targetId))
      item.innerHTML = `
        <img src="./icons/${target.icon}" alt="" width="26" height="26" />
        <span>
          <span class="dm-title"></span>
          <span class="dm-sub"></span>
        </span>`
      item.querySelector('.dm-title').textContent = target.fullName
      item.querySelector('.dm-sub').textContent = target.tagline
      item.addEventListener('click', () => {
        this._pickTarget(target.id)
        this._togglePopover($('device-chip'), menu, false)
      })
      menu.appendChild(item)
    }
  }

  async _pickTarget(targetId) {
    if (this.device.isConnected && this.device.targetId && this.device.targetId !== targetId) {
      toast({
        kind: 'warn',
        title: t('pick.otherTitle'),
        detail: t('pick.otherDetail', { device: getTarget(this.device.targetId)?.name }),
      })
      return
    }

    // Blocks for the old board would just sit there unrunnable, so offer to
    // start over — but never throw away work without asking.
    const strays = [...devicesUsed(this.workspace.workspace)].filter((id) => id !== targetId)
    let startFresh = this.workspace.isEmpty
    if (strays.length) {
      const device = getTarget(targetId)?.name
      startFresh = await showModal({
        title: t('pick.switchTitle', { device }),
        bodyHtml: t('pick.switchBodyHtml', { names: deviceNames(strays), device }),
        confirmText: t('pick.startFresh'),
        cancelText: t('pick.keep'),
      })
    }

    this.pickedTarget = targetId
    localStorage.setItem(PICKED_DEVICE, targetId)
    this.workspace.setTarget(targetId)
    if (startFresh) {
      this.workspace.clear()
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
    }
    this._renderDevicePicker()
    this._refreshDeviceChip()
  }

  _refreshDeviceChip() {
    const chip = $('device-chip')
    const connected = this.device.isConnected
    const target = getTarget(this.device.targetId || this.workspace.targetId)
    const dot = chip.querySelector('.device-chip-dot')

    chip.dataset.connected = String(connected)
    dot.dataset.state = connected
      ? this.device.state === State.LOADING
        ? 'busy'
        : 'on'
      : 'off'
    $('device-chip-label').textContent = target ? target.name : t('chip.pick')
    $('device-chip-icon').src = `./icons/${target?.icon || 'dev-any.svg'}`

    const connect = $('btn-connect')
    connect.dataset.connected = String(connected)
    connect.querySelector('.btn-text').textContent = t(connected ? 'btn.disconnect' : 'btn.connect')
    connect.querySelector('.btn-emoji').textContent = connected ? '✅' : '🔌'
  }

  _refreshButtons() {
    const connected = this.device.isConnected
    const loading = this.device.state === State.LOADING
    $('btn-run').disabled = !connected || loading
    $('btn-stop').disabled = !connected
  }

  _setStatus(state, message) {
    const chip = $('status-chip')
    const known = [State.OFFLINE, State.CONNECTING, State.READY, State.LOADING, State.RUNNING, 'error']
    chip.textContent = t(`status.${known.includes(state) ? state : State.READY}`)
    chip.dataset.state =
      { [State.READY]: 'ready', [State.LOADING]: 'busy', [State.RUNNING]: 'running', error: 'error' }[
        state
      ] || 'idle'
    $('status-msg').textContent = message || ''
  }

  // ---------------------------------------------------------- workspace

  _bindWorkspace() {
    let timer
    this.workspace.addEventListener('change', () => {
      $('blocks-hint').hidden = !this.workspace.isEmpty
      clearTimeout(timer)
      timer = setTimeout(() => {
        this._refreshPython()
        this.workspace.save()
      }, 250)
    })
  }

  _currentPython() {
    return generatePython(this.workspace.workspace, this.workspace.targetId)
  }

  _refreshPython() {
    const code = this._currentPython()
    $('python-view').innerHTML = `<code>${highlightPython(code)}</code>`
    $('blocks-hint').hidden = !this.workspace.isEmpty
  }

  // -------------------------------------------------------------- menu

  async _menuAction(action) {
    switch (action) {
      case 'new':
        this._newProject()
        break
      case 'open':
        $('file-input').click()
        break
      case 'save':
        this._saveFile()
        break
      case 'export-py':
        download('main.py', this._currentPython(), 'text/x-python')
        toast({ kind: 'info', title: t('pySaved.title'), detail: t('pySaved.detail') })
        break
      case 'copy-py':
        try {
          await navigator.clipboard.writeText(this._currentPython())
          toast({ kind: 'info', title: t('pyCopied.title') })
        } catch {
          toast({ kind: 'warn', title: t('pyCopyFailed.title'), detail: t('pyCopyFailed.detail') })
        }
        break
      case 'help':
        showModal({ title: t('help.title'), bodyHtml: t('help.bodyHtml') })
        break
      case 'about':
        showModal({ title: t('about.title'), bodyHtml: t('about.bodyHtml') })
        break
    }
  }

  /** Start over, asking first if there is anything to lose. */
  async _newProject() {
    if (!this.workspace.isEmpty) {
      const ok = await showModal({
        title: t('new.title'),
        bodyHtml: t('new.bodyHtml'),
        confirmText: t('new.confirm'),
        cancelText: t('pick.keep'),
      })
      if (!ok) return
    }
    this.workspace.clear()
    this.workspace.rename(DEFAULT_PROJECT_NAME)
    this.terminal.say(t('new.started'))
    $('project-name').focus()
    $('project-name').select()
  }

  _saveFile() {
    const name = fileNameFor(this.workspace.name, 'ocb')
    download(name, JSON.stringify(this.workspace.toProject(), null, 2), 'application/json')
    toast({ kind: 'info', title: t('saved.title'), detail: t('saved.detail', { file: name }) })
  }

  async _openFile(file) {
    if (!file) return
    try {
      this.workspace.loadProject(JSON.parse(await file.text()))
      this._renderDevicePicker()
      this._refreshDeviceChip()
      toast({ kind: 'info', title: t('opened.title') })
    } catch (err) {
      toast({ kind: 'error', title: t('openFailed.title'), detail: err.message })
    } finally {
      $('file-input').value = ''
    }
  }

  // ------------------------------------------------------------- first run

  _checkBrowser() {
    if (this.device.supported) return
    $('browser-note').textContent = t('browser.note')
    $('btn-connect').disabled = true
    this.terminal.warn(`${t('browser.noSerial')}\r\n${t('browser.noSerialHint')}`)
  }

  _maybeWelcome() {
    if (localStorage.getItem(SEEN_WELCOME)) return
    localStorage.setItem(SEEN_WELCOME, '1')
    showModal({ title: t('welcome.title'), bodyHtml: t('welcome.bodyHtml'), confirmText: t('welcome.confirm') })
  }
}

/** Boards' names as a list: "CodeX and CodeAIR". */
function deviceNames(ids) {
  return listOf(ids.map((id) => getTarget(id)?.name))
}

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const KNOWN_ERRORS = ['NameError', 'SyntaxError', 'TypeError', 'ValueError', 'ZeroDivisionError', 'MemoryError', 'ImportError', 'OSError']

function friendlyErrorTitle(name) {
  return KNOWN_ERRORS.includes(name) ? t(`pyerr.${name}`) : t('pyerr.other', { name })
}
