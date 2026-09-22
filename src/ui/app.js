/** Wires the workspace, the board and the chrome around them together. */
import { DeviceManager, State } from '../device/device-manager.js'
import { SUPPORTED_TARGETS, getTarget } from '../device/targets.js'
import { BlockWorkspace, STARTER_PROJECTS } from '../workspace/workspace.js'
import { generatePython, highlightPython, devicesUsed } from '../blocks/index.js'
import { TerminalPanel } from './terminal.js'
import { toast, showModal } from './notify.js'
import { HELP_HTML, ABOUT_HTML, welcomeHtml } from './copy.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1'
const PICKED_DEVICE = 'opencodebot.device.v1'

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    this.device = new DeviceManager()
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
    this.device.link.openPaired?.().catch(() => {})
  }

  _greet() {
    this.terminal.write(
      '\x1b[32mHi! This is a live Python prompt on your device.\x1b[0m\r\n' +
        '\x1b[90mPlug a device in, press Connect, and start typing.\x1b[0m\r\n',
    )
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
          this.terminal.say(`${target.name} connected — firmware ${firmware.version} (${firmware.date})`)
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
        detail: [message, line ? `(Python line ${line})` : ''].filter(Boolean).join(' '),
      })
      this._setStatus('error', `${name}: ${message}`)
    })

    device.addEventListener('progress', (e) => {
      const pct = Math.round(e.detail * 100)
      this._setStatus(State.LOADING, `Sending your program… ${pct}%`)
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

    const name = getTarget(targetId)?.name
    if (conflicting.length) {
      toast({
        kind: 'warn',
        title: `Switched to ${name} blocks`,
        detail: `Your project still has ${conflicting.map((id) => getTarget(id)?.name).join(' and ')} blocks in it.`,
      })
    } else if (this.workspace.isEmpty) {
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
      toast({ kind: 'info', title: `${name} is ready!`, detail: 'Here is a tiny program to try.' })
    } else {
      toast({ kind: 'info', title: `${name} connected`, detail: 'Your blocks are ready to run.' })
    }
  }

  async _toggleConnect() {
    if (this.device.isConnected) {
      await this.device.disconnect()
      this.terminal.warn('Device disconnected.')
      return
    }
    const ok = await this.device.connect()
    if (ok) this.terminal.focus()
  }

  async _run() {
    if (this.workspace.isEmpty) {
      toast({ kind: 'warn', title: 'Nothing to run yet', detail: 'Drag some blocks in first!' })
      return
    }
    const target = this.device.targetId
    const used = devicesUsed(this.workspace.workspace)
    const wrong = [...used].filter((id) => id !== target)
    if (target && wrong.length) {
      toast({
        kind: 'warn',
        title: 'Those blocks are for another device',
        detail: `Your project uses ${wrong.map((id) => getTarget(id)?.name).join(' and ')} blocks, but a ${getTarget(target)?.name} is plugged in.`,
      })
      return
    }

    const code = this._currentPython()
    this.terminal.say('Sending your program…')
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
    menu.innerHTML = '<div class="dm-head">I am using a…</div>'
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
        title: 'A different device is plugged in',
        detail: `Unplug the ${getTarget(this.device.targetId)?.name} first, or press Connect again after swapping.`,
      })
      return
    }

    // Blocks for the old board would just sit there unrunnable, so offer to
    // start over — but never throw away work without asking.
    const strays = [...devicesUsed(this.workspace.workspace)].filter((id) => id !== targetId)
    let startFresh = this.workspace.isEmpty
    if (strays.length) {
      const names = strays.map((id) => getTarget(id)?.name).join(' and ')
      startFresh = await showModal({
        title: `Switch to ${getTarget(targetId)?.name}?`,
        bodyHtml: `<p>Your project uses ${names} blocks, which a ${getTarget(targetId)?.name} cannot run.</p>
          <p>Start a fresh project, or keep these blocks and switch anyway?</p>`,
        confirmText: 'Start fresh',
        cancelText: 'Keep my blocks',
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
    $('device-chip-label').textContent = target ? target.name : 'Pick a device'
    $('device-chip-icon').src = `./icons/${target?.icon || 'dev-any.svg'}`

    const connect = $('btn-connect')
    connect.dataset.connected = String(connected)
    connect.querySelector('.btn-text').textContent = connected ? 'Disconnect' : 'Connect'
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
    const label =
      {
        [State.OFFLINE]: 'Not connected',
        [State.CONNECTING]: 'Connecting',
        [State.READY]: 'Ready',
        [State.LOADING]: 'Sending',
        [State.RUNNING]: 'Running',
        error: 'Oops',
      }[state] || 'Ready'
    chip.textContent = label
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
      case 'new': {
        const ok = await showModal({
          title: 'Start a new project?',
          bodyHtml: '<p>Your current blocks will be cleared. This cannot be undone.</p>',
          confirmText: 'Yes, clear it',
          cancelText: 'Keep my blocks',
        })
        if (ok) this.workspace.clear()
        break
      }
      case 'open':
        $('file-input').click()
        break
      case 'save':
        this._saveFile()
        break
      case 'export-py':
        download('main.py', this._currentPython(), 'text/x-python')
        toast({ kind: 'info', title: 'Python saved', detail: 'Look in your Downloads folder for main.py.' })
        break
      case 'copy-py':
        try {
          await navigator.clipboard.writeText(this._currentPython())
          toast({ kind: 'info', title: 'Python copied!' })
        } catch {
          toast({ kind: 'warn', title: 'Could not copy', detail: 'Select the code in the Python tab instead.' })
        }
        break
      case 'help':
        showModal({ title: 'Help & shortcuts', bodyHtml: HELP_HTML })
        break
      case 'about':
        showModal({ title: 'About OpenCodeBot', bodyHtml: ABOUT_HTML })
        break
    }
  }

  _saveFile() {
    const name = `${(getTarget(this.workspace.targetId)?.name || 'project').toLowerCase()}-blocks.ocb`
    download(name, JSON.stringify(this.workspace.toProject(), null, 2), 'application/json')
    toast({ kind: 'info', title: 'Project saved', detail: `Look in your Downloads folder for ${name}.` })
  }

  async _openFile(file) {
    if (!file) return
    try {
      this.workspace.loadProject(JSON.parse(await file.text()))
      this._renderDevicePicker()
      this._refreshDeviceChip()
      toast({ kind: 'info', title: 'Project opened!' })
    } catch (err) {
      toast({ kind: 'error', title: 'Could not open that file', detail: err.message })
    } finally {
      $('file-input').value = ''
    }
  }

  // ------------------------------------------------------------- first run

  _checkBrowser() {
    if (this.device.supported) return
    $('browser-note').textContent = 'This browser cannot connect to devices — try Chrome or Edge.'
    $('btn-connect').disabled = true
    this.terminal.warn(
      'This browser does not support Web Serial, so OpenCodeBot cannot talk to your device.\r\n' +
        'You can still build blocks and download the Python. Chrome or Edge on a computer will connect.',
    )
  }

  _maybeWelcome() {
    if (localStorage.getItem(SEEN_WELCOME)) return
    localStorage.setItem(SEEN_WELCOME, '1')
    showModal({ title: 'Welcome to OpenCodeBot!', bodyHtml: welcomeHtml(), confirmText: "Let's go!" })
  }
}

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function friendlyErrorTitle(name) {
  return (
    {
      NameError: 'Something has no name yet',
      SyntaxError: 'The device could not read that code',
      TypeError: 'Those pieces do not fit together',
      ValueError: 'That value was out of range',
      ZeroDivisionError: 'Cannot divide by zero',
      MemoryError: 'The program is too big for the device',
      ImportError: 'A missing part of the device library',
      OSError: 'The device had trouble with that',
    }[name] || `Your program stopped: ${name}`
  )
}
