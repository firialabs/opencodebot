/** Wires the workspace, the board and the chrome around them together. */
import { State, createDevice, deviceKindFromUrl } from '../device/device-target.js'
// Each import registers a kind of device. Add a simulator the same way.
import '../device/device-manager.js'
import '../device/loopback-device.js'
import { SUPPORTED_TARGETS, getTarget } from '../device/targets.js'
import { BlockWorkspace, STARTER_PROJECTS, DEFAULT_PROJECT_NAME, fileNameFor } from '../workspace/workspace.js'
import { generatePython, generateWithLines, highlightPython, devicesUsed } from '../blocks/index.js'
import { TerminalPanel } from './terminal.js'
import { toast, showModal } from './notify.js'
import { t, listOf, LANGUAGES, language, languageName, setLanguage } from '../i18n/index.js'
import { DeviceSwitch } from '../sim/device-switch.js'
import { SimDevice } from '../sim/sim-device.js'   // registers the 'sim' kind
import { SimPanel } from '../sim/sim-panel.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1'
const PICKED_DEVICE = 'opencodebot.device.v1'

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    // The kind the page was opened with (?device=) is the board; the simulator
    // sits beside it, behind Simulate. ?device=sim opens in the simulator.
    const kind = deviceKindFromUrl()
    this.device = new DeviceSwitch(createDevice(kind === 'sim' ? 'serial' : kind), createDevice('sim'))
    this.simPanel = new SimPanel($('sim-host'), this.device.sim, {
      onStart: () => this._toggleSimulate(),
      onStepStart: () => this._run({ stepFirst: true }),
    })
    this.pickedTarget = localStorage.getItem(PICKED_DEVICE) || null

    this.workspace = new BlockWorkspace($('blockly-root'), this.pickedTarget)
    this.terminal = new TerminalPanel($('terminal-host'), (data) => this.device.sendRaw(data))

    this._bindDevice()
    this._bindChrome()
    // A paused program's line, on its block and in the Python tab.
    this.device.sim.addEventListener('line', (e) => this._showLine(e.detail.line))
    this._bindWorkspace()
    this._bindTextMode()

    if (!this.workspace.restore() && this.pickedTarget) {
      this.workspace.loadProject(STARTER_PROJECTS[this.pickedTarget] || { blocks: {} })
    }

    this._greet()
    this._renderDevicePicker()
    this._renderLanguages()
    this._refreshDeviceChip()
    this._refreshPython()
    this._checkBrowser()
    this._maybeWelcome()

    // A board that is already plugged in and paired can just come back.
    this.device.autoConnect().catch(() => {})
    if (kind === 'sim') this._toggleSimulate()
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

  async _toggleSimulate() {
    if (this.device.simulating) {
      await this.device.disconnect()
      this._refreshSimButton()
      return
    }
    const target = this.pickedTarget || 'codebot'
    if (!SimDevice.canSimulate(target)) {
      const [title, detail] = SimDevice.whyNot(target)
      toast({ kind: 'warn', title, detail })
      return
    }
    this._selectTab('sim')
    await this.device.simulate(target)
    this._refreshSimButton()
  }

  _refreshSimButton() {
    const on = this.device.simulating
    const b = $('btn-sim')
    b.dataset.connected = String(on)
    b.querySelector('.btn-text').textContent = t(on ? 'btn.stopSimulator' : 'btn.simulate')
  }

  async _toggleConnect() {
    if (this.device.isConnected && !this.device.simulating) {
      await this.device.disconnect()
      this.terminal.warn(t('term.disconnected'))
      return
    }
    const ok = await this.device.connect()
    if (ok) this.terminal.focus()
  }

  // stepFirst (the simulator): pause at the first line, to step by line.
  async _run(opts = {}) {
    const textMode = this.workspace.mode === 'text'
    if (textMode ? !this.workspace.pythonText.trim() : this.workspace.isEmpty) {
      toast({
        kind: 'warn',
        title: t('run.emptyTitle'),
        detail: t(textMode ? 'run.emptyTextDetail' : 'run.emptyDetail'),
      })
      return
    }
    const target = this.device.targetId
    const used = textMode ? new Set() : devicesUsed(this.workspace.workspace)
    const wrong = [...used].filter((id) => id !== target)
    if (target && wrong.length) {
      toast({
        kind: 'warn',
        title: t('run.wrongTitle'),
        detail: t('run.wrongDetail', { names: deviceNames(wrong), device: getTarget(target)?.name }),
      })
      return
    }

    // Typed Python runs as typed, with no blocks behind its lines (line n is
    // the editor's line n); the blocks' Python knows which block made each line.
    const { code, blockAt } = textMode
      ? { code: this.workspace.pythonText, blockAt: {} }
      : generateWithLines(this.workspace.workspace, this.workspace.targetId)
    this._ran = { code, blockAt, text: textMode }
    this.terminal.say(t('term.sending'))
    await this.device.run(code, opts)
  }

  // Mark the line a paused program is at (null: none): typed Python's line in
  // the editor, while it still holds the program that runs; else on its block
  // and in the Python tab, while that tab still shows the program that runs.
  _showLine(line) {
    const ws = this.workspace.workspace
    const id = line && this._ran?.blockAt[line]
    ws.highlightBlock?.(id && ws.getBlockById(id) ? id : null)
    if (this._ran?.text) {
      const editor = $('python-editor')
      if (!line || editor.value !== this._ran.code) return
      const lines = editor.value.split('\n')
      const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
      editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 18
      editor.scrollTop = Math.max(0, (line - 3) * lineHeight)
      return
    }
    const view = $('python-view')
    view.querySelector('.py-line.is-current')?.classList.remove('is-current')
    if (!line || this._shownCode !== this._ran?.code) return
    const el = view.querySelector(`.py-line[data-n="${line}"]`)
    el?.classList.add('is-current')
    el?.scrollIntoView({ block: 'nearest' })
  }

  async _stop() {
    await this.device.stop()
  }

  // ------------------------------------------------------------ chrome

  _bindChrome() {
    $('btn-connect').addEventListener('click', () => this._toggleConnect())
    $('btn-sim').addEventListener('click', () => this._toggleSimulate())
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
      } else if (e.key === 'Escape' && this.device.state === State.RUNNING && e.target.id !== 'python-editor') {
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
    if (name === 'sim') this.device.sim.view?.resize()
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
    // In text mode Run sends the typed Python, so blocks for another board
    // are no reason to start over.
    const strays =
      this.workspace.mode === 'text'
        ? []
        : [...devicesUsed(this.workspace.workspace)].filter((id) => id !== targetId)
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

    const usb = connected && !this.device.simulating
    const connect = $('btn-connect')
    connect.dataset.connected = String(usb)
    connect.querySelector('.btn-text').textContent = t(usb ? 'btn.disconnect' : 'btn.connect')
    connect.querySelector('.btn-emoji').textContent = usb ? '✅' : '🔌'
    this._refreshSimButton()
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
      $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.workspace.mode === 'text'
      clearTimeout(timer)
      timer = setTimeout(() => {
        this._refreshPython()
        this.workspace.save()
      }, 250)
    })
  }

  /** The program Run sends: typed Python in text mode, else the blocks'. */
  _currentPython() {
    if (this.workspace.mode === 'text') return this.workspace.pythonText
    return this._blocksPython()
  }

  _blocksPython() {
    return generatePython(this.workspace.workspace, this.workspace.targetId)
  }

  _refreshPython() {
    if (this.workspace.mode !== 'text') {
      const code = this._blocksPython()
      this._shownCode = code
      // One span a line (the highlighter's spans never cross a line), so a
      // paused program's line can be marked.
      const lines = highlightPython(code).split('\n')
      $('python-view').innerHTML = `<code>${lines.map((l, i) => `<span class="py-line" data-n="${i + 1}">${l}</span>`).join('\n')}</code>`
    }
    $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.workspace.mode === 'text'
  }

  // ------------------------------------------------------- blocks or text

  _bindTextMode() {
    const editor = $('python-editor')
    $('btn-mode').addEventListener('click', () =>
      this.workspace.mode === 'text' ? this._toBlocks() : this._toText(),
    )
    $('btn-back-to-blocks').addEventListener('click', () => this._toBlocks())
    editor.addEventListener('input', () => this.workspace.setPythonText(editor.value))
    editor.addEventListener('keydown', (e) => indentKeys(e, editor))
    this.workspace.addEventListener('mode', () => this._showMode())
  }

  _toText() {
    this.workspace.setMode('text', this._blocksPython())
    $('python-editor').focus()
    toast({
      kind: 'info',
      title: t('text.startedTitle'),
      detail: t('text.startedDetail'),
    })
  }

  async _toBlocks() {
    // Typed changes cannot be turned back into blocks, so ask before
    // throwing them away. Untouched code needs no question.
    const changed = this.workspace.pythonText.trim() !== this._blocksPython().trim()
    if (changed) {
      const ok = await showModal({
        title: t('text.backTitle'),
        bodyHtml: t('text.backBodyHtml'),
        confirmText: t('text.backConfirm'),
        cancelText: t('text.keep'),
      })
      if (!ok) return
    }
    this.workspace.setMode('blocks')
  }

  /** Make the screen match the mode. */
  _showMode() {
    const text = this.workspace.mode === 'text'
    const editor = $('python-editor')
    if (text && editor.value !== this.workspace.pythonText) editor.value = this.workspace.pythonText
    editor.hidden = !text
    $('python-view').hidden = text
    $('text-mode-cover').hidden = !text
    $('blocks-pane').classList.toggle('is-text-mode', text)
    $('btn-mode').textContent = t(text ? 'text.toBlocks' : 'text.toText')
    $('python-bar-msg').textContent = t(text ? 'text.barText' : 'text.barBlocks')
    // In text mode the program lives in the Python tab, so show it.
    if (text) this._selectTab('python')
    this._refreshPython()
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
      default:
        if (action.startsWith('lang:') && action.slice(5) !== language) setLanguage(action.slice(5))
    }
  }

  /** One item per language in the ⋯ menu, each named in its own language. */
  _renderLanguages() {
    const group = $('lang-menu')
    for (const lang of LANGUAGES) {
      const item = document.createElement('button')
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(lang === language))
      item.dataset.action = `lang:${lang}`
      item.lang = lang
      item.textContent = languageName(lang)
      group.append(item)
    }
  }

  /** Start over, asking first if there is anything to lose. */
  async _newProject() {
    if (!this.workspace.isEmpty) {
      const text = this.workspace.mode === 'text'
      const ok = await showModal({
        title: t('new.title'),
        bodyHtml: t(text ? 'new.bodyTextHtml' : 'new.bodyHtml'),
        confirmText: t('new.confirm'),
        cancelText: t(text ? 'new.keepText' : 'pick.keep'),
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
    this.terminal.warn(`${t('browser.noSerial')}\r\n${t('browser.noSerialHintSim')}`)
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

/** Tab and Shift+Tab indent by four spaces; Escape lets the next Tab leave. */
function indentKeys(e, editor) {
  if (e.key === 'Escape') {
    editor.dataset.tabLeaves = '1'
    return
  }
  if (e.key !== 'Tab') {
    delete editor.dataset.tabLeaves
    return
  }
  if (editor.dataset.tabLeaves) {
    delete editor.dataset.tabLeaves
    return // let the browser move focus
  }
  e.preventDefault()
  const { selectionStart: start, selectionEnd: end, value } = editor
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  if (e.shiftKey) {
    const lead = value.slice(lineStart, lineStart + 4).match(/^ */)[0].length
    if (!lead) return
    editor.setRangeText('', lineStart, lineStart + lead, 'preserve')
    editor.setSelectionRange(Math.max(lineStart, start - lead), Math.max(lineStart, end - lead))
  } else {
    editor.setRangeText('    ', start, end, 'end')
  }
  editor.dispatchEvent(new Event('input'))
}
