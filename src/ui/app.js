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
import { examplesFor, exampleProject, EXAMPLE_DEVICES } from '../examples/index.js'
import { t, listOf, LANGUAGES, language, languageName, setLanguage } from '../i18n/index.js'
import { DeviceSwitch } from '../sim/device-switch.js'
import { SimDevice } from '../sim/sim-device.js'   // registers the 'sim' kind
import { SimPanel } from '../sim/sim-panel.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1'
const PICKED_DEVICE = 'opencodebot.device.v1'
const TERMINAL_PANEL = 'opencodebot.terminalPanel.v1'

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    // The kind the page was opened with (?device=) is the board; the simulator
    // sits beside it, behind Simulate. ?device=sim opens in the simulator.
    const kind = deviceKindFromUrl()
    this.device = new DeviceSwitch(createDevice(kind === 'sim' ? 'serial' : kind), createDevice('sim'))
    this.simPanel = new SimPanel($('sim-host'), this.device.sim)
    this.pickedTarget = localStorage.getItem(PICKED_DEVICE) || null

    this.workspace = new BlockWorkspace($('blockly-root'), this.pickedTarget)
    this.terminal = new TerminalPanel($('terminal-host'), (data) => this.device.sendRaw(data))

    this._bindDevice()
    this._bindChrome()
    // A paused program's line, on its block and in the Python view.
    this.device.sim.addEventListener('line', (e) => this._showLine(e.detail.line))
    this._bindWorkspace()
    this._bindTextMode()

    if (!this.workspace.restore() && this.pickedTarget) {
      this.workspace.loadProject(STARTER_PROJECTS[this.pickedTarget] || { blocks: {} })
    }
    this._showMode()

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
      this._refreshSide()
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
    this._roomForSim()
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

  async _run() {
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
    await this.device.run(code)
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

  // Pause and Step are the simulator's: a real board cannot hold a program
  // still. Step runs the program on to its next line and pauses there.
  _togglePause() {
    const sim = this.device.sim
    if (!this.device.simulating || this.device.state !== State.RUNNING) return
    if (sim.paused) sim.resume()
    else sim.pause()
  }

  _step() {
    if (this.device.simulating && this.device.state === State.RUNNING) this.device.sim.stepLine()
  }

  // ------------------------------------------------------------ chrome

  _bindChrome() {
    $('btn-connect').addEventListener('click', () => this._toggleConnect())
    $('btn-sim').addEventListener('click', () => this._toggleSimulate())
    $('btn-run').addEventListener('click', () => this._run())
    $('btn-stop').addEventListener('click', () => this._stop())
    $('btn-pause').addEventListener('click', () => this._togglePause())
    $('btn-step').addEventListener('click', () => this._step())
    $('btn-clear-term').addEventListener('click', () => this.terminal.clear())
    $('btn-term-toggle').addEventListener('click', () => this._setTermOpen(!this.termOpen))
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

    // Escape closes an open menu and returns focus to the button that opened it.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      for (const [button, panel] of [
        [chip, menu],
        [menuBtn, appMenu],
      ]) {
        if (!panel.hidden) {
          this._togglePopover(button, panel, false)
          button.focus()
          e.stopImmediatePropagation()
        }
      }
    })

    // Run and Save work from anywhere, the terminal included: caught on the
    // way down, before the terminal takes the keys for itself.
    document.addEventListener(
      'keydown',
      (e) => {
        const meta = e.ctrlKey || e.metaKey
        if (meta && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          this._run()
        } else if (meta && e.key.toLowerCase() === 's') {
          e.preventDefault()
          e.stopPropagation()
          this._saveFile()
        }
      },
      true,
    )
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.device.state === State.RUNNING && e.target.id !== 'python-editor') {
        this._stop()
      }
    })

    this._bindSplitter()
    this._bindTermSplitter()
    window.addEventListener('resize', () => {
      this.workspace.resize()
      this._fitTerm()
      this.terminal.resize()
    })
  }

  _togglePopover(button, panel, force) {
    const open = force ?? panel.hidden
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  // ------------------------------------------------------------ side pane

  /**
   * The side: the simulator on top while it is on (starting included), the
   * terminal panel under it. With no simulator the terminal fills the side
   * and cannot be closed; with one, it can be closed to its header or resized.
   */
  _refreshSide() {
    const sim = this.device.active === this.device.sim && this.device.sim.state !== State.OFFLINE
    const side = $('side-pane')
    side.dataset.sim = String(sim)
    side.dataset.term = this.termOpen ? 'open' : 'closed'
    $('panel-sim').hidden = !sim
    $('term-splitter').hidden = !sim || !this.termOpen
    $('term-body').hidden = sim && !this.termOpen
    const toggle = $('btn-term-toggle')
    toggle.hidden = !sim
    toggle.textContent = this.termOpen ? '▾' : '▴'
    toggle.setAttribute('aria-expanded', String(this.termOpen))
    const label = t(this.termOpen ? 'term.hide' : 'term.show')
    toggle.title = label
    toggle.setAttribute('aria-label', label)
    // After the simulator's own panel has caught up (its bar shows once it is ready).
    requestAnimationFrame(() => this._fitTerm())
  }

  _setTermOpen(open) {
    this.termOpen = open
    this._saveTerm()
    this._refreshSide()
    requestAnimationFrame(() => this._fitTerm())
  }

  _saveTerm() {
    try {
      localStorage.setItem(TERMINAL_PANEL, JSON.stringify({ open: this.termOpen, height: this.termHeight }))
    } catch {}
  }

  /** Clamp the terminal's height to the side as it is now, and resize what is in it. */
  _fitTerm() {
    const side = $('side-pane')
    const room = side.getBoundingClientRect().height
    const head = document.querySelector('.term-head').getBoundingClientRect().height
    // The simulator keeps its bar and at least 120 px of view above the divider.
    const simBar = document.querySelector('.sim-bar')?.getBoundingClientRect().height || 0
    const least = head + 60
    const height = Math.round(Math.min(Math.max(this.termHeight, least), Math.max(least, room - 6 - simBar - 120)))
    side.style.setProperty('--term-h', `${height}px`)
    if (room > 0) {
      $('term-splitter').setAttribute('aria-valuenow', String(Math.round(100 - (height / room) * 100)))
    }
    this.device.sim.view?.resize()
    this.terminal.resize()
    return height
  }

  _bindTermSplitter() {
    try {
      const saved = JSON.parse(localStorage.getItem(TERMINAL_PANEL) || '{}')
      this.termOpen = saved.open !== false
      this.termHeight = Number(saved.height) || 220
    } catch {
      this.termOpen = true
      this.termHeight = 220
    }
    this._refreshSide()

    const splitter = $('term-splitter')
    const set = (px) => {
      this.termHeight = px
      this.termHeight = this._fitTerm()
      this._saveTerm()
    }
    let dragging = false
    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      splitter.setPointerCapture(e.pointerId)
    })
    splitter.addEventListener('pointermove', (e) => {
      if (dragging) set($('side-pane').getBoundingClientRect().bottom - e.clientY)
    })
    splitter.addEventListener('pointerup', () => {
      dragging = false
    })
    // Up makes the terminal taller, Down shorter; Shift moves further.
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 120 : 40
      const grow = { ArrowUp: step, ArrowDown: -step }[e.key]
      if (!grow) return
      e.preventDefault()
      set(this.termHeight + grow)
    })
  }

  _bindSplitter() {
    const splitter = $('splitter')
    const workarea = document.querySelector('.workarea')
    let dragging = false
    const vertical = () => window.matchMedia('(max-width: 880px)').matches

    /** Size the side pane in pixels, clamped, and report it as a percentage. */
    const setSide = (px) => {
      const rect = workarea.getBoundingClientRect()
      let pct
      if (vertical()) {
        const height = Math.min(Math.max(px, 120), rect.height - 140)
        workarea.style.gridTemplateRows = `1fr 6px ${height}px`
        pct = 100 - (height / rect.height) * 100
      } else {
        const width = Math.min(Math.max(px, 220), rect.width - 280)
        workarea.style.setProperty('--side-w', `${width}px`)
        pct = 100 - (width / rect.width) * 100
      }
      // The value is the blocks area's share, which is what moving it changes.
      splitter.setAttribute('aria-valuenow', String(Math.round(pct)))
      this.workspace.resize()
      this.terminal.resize()
    }
    const sideNow = () => {
      const side = $('side-pane').getBoundingClientRect()
      return vertical() ? side.height : side.width
    }

    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      splitter.setPointerCapture(e.pointerId)
    })
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const rect = workarea.getBoundingClientRect()
      setSide(vertical() ? rect.bottom - e.clientY : rect.right - e.clientX)
    })
    splitter.addEventListener('pointerup', () => {
      dragging = false
    })

    // Arrow keys move the divider, so it works without a mouse.
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 120 : 40
      const grow = vertical() ? { ArrowUp: step, ArrowDown: -step } : { ArrowLeft: step, ArrowRight: -step }
      if (!(e.key in grow)) return
      e.preventDefault()
      setSide(sideNow() + grow[e.key])
    })
    requestAnimationFrame(() => setSide(sideNow()))

    // On a narrow screen the side is a strip under the blocks: the simulator
    // and the terminal both need more of it, so starting the simulator grows it.
    this._roomForSim = () => {
      if (!vertical()) return
      const want = workarea.getBoundingClientRect().height * 0.6
      if (sideNow() < want) setSide(want)
    }
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

  /**
   * At rest only Run shows. Running: Stop, and in the simulator Pause. Once
   * paused, Pause says Resume and Step shows too; both stay until the
   * program stops, then it is Run alone again. A button that hides while it
   * has the keyboard hands it to the one now in its place.
   */
  _refreshButtons() {
    const connected = this.device.isConnected
    const running = connected && this.device.state === State.RUNNING
    const sim = running && this.device.simulating
    const paused = sim && this.device.sim.paused
    if (paused) this._stepping = true
    if (!running) this._stepping = false

    const had = document.activeElement
    const run = $('btn-run')
    const stop = $('btn-stop')
    const pause = $('btn-pause')
    const step = $('btn-step')
    run.hidden = running
    run.disabled = !connected || this.device.state === State.LOADING
    stop.hidden = !running
    pause.hidden = !sim
    step.hidden = !(sim && this._stepping)
    pause.querySelector('.btn-emoji').textContent = paused ? '▶' : '⏸'
    pause.querySelector('.btn-text').textContent = t(paused ? 'btn.resume' : 'btn.pause')

    if ([run, stop, pause, step].includes(had) && had.hidden) {
      ;(running ? (paused ? step : stop) : run).focus()
    }
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
      $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.view === 'python'
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
    $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.view === 'python'
  }

  // ------------------------------------------------------- blocks or text

  _bindTextMode() {
    const editor = $('python-editor')
    $('btn-mode').addEventListener('click', () =>
      this.workspace.mode === 'text' ? this._toBlocks() : this._toText(),
    )
    $('btn-view').addEventListener('click', () => this._toggleView())
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

  /**
   * The editor area shows the blocks or the Python, never both. Typed Python
   * (text mode) is always shown as Python; leaving it for the blocks goes
   * through _toBlocks, which asks before typed changes are lost.
   */
  async _toggleView() {
    if (this.view === 'python') {
      if (this.workspace.mode === 'text') return this._toBlocks()
      this._showView('blocks')
    } else {
      this._showView('python')
    }
  }

  _showView(view) {
    this.view = view
    const python = view === 'python'
    $('code-pane').hidden = !python
    $('blockly-root').hidden = python
    $('blocks-pane').classList.toggle('is-python', python)
    const toggle = $('btn-view')
    toggle.textContent = t(python ? 'view.toBlocks' : 'view.toPython')
    toggle.setAttribute('aria-label', t(python ? 'view.toBlocksLabel' : 'view.toPythonLabel'))
    toggle.setAttribute('aria-expanded', String(python))
    if (!python) this.workspace.resize()
    this._refreshPython()
  }

  /** Make the screen match the mode. */
  _showMode() {
    const text = this.workspace.mode === 'text'
    const editor = $('python-editor')
    if (text && editor.value !== this.workspace.pythonText) editor.value = this.workspace.pythonText
    editor.hidden = !text
    $('python-view').hidden = text
    $('btn-mode').textContent = t(text ? 'text.toBlocks' : 'text.toText')
    $('python-bar-msg').textContent = t(text ? 'text.barText' : 'text.barBlocks')
    // Typed Python is shown as Python; going back to blocks shows the blocks.
    this._showView(text ? 'python' : 'blocks')
  }

  // -------------------------------------------------------------- menu

  async _menuAction(action) {
    switch (action) {
      case 'new':
        this._newProject()
        break
      case 'examples':
        this._openExamples()
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
        showModal({ title: t('about.title'), bodyHtml: t('about.betaHtml') + t('about.bodyHtml') + t('about.privacyHtml') })
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

  // ------------------------------------------------------------- examples

  /** The example picker: a board switch, then that board's examples, easiest first. */
  _examplesHtml(device) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const boards = EXAMPLE_DEVICES.map(
      (id) =>
        `<button type="button" class="ex-board" data-ex-device="${id}" aria-pressed="${id === device}">${esc(getTarget(id)?.name || id)}</button>`,
    ).join('')
    const items = examplesFor(device)
      .map(
        (ex, i) =>
          `<li><button type="button" class="ex-item" data-example="${ex.id}"><span class="ex-num" aria-hidden="true">${i + 1}</span><span class="ex-text"><span class="ex-title">${esc(ex.title)}</span><span class="ex-goal">${esc(ex.goal)}</span></span></button></li>`,
      )
      .join('')
    return `<p>${esc(t('examples.intro'))}</p>
      <div class="ex-boards" role="group" aria-label="${esc(t('examples.boards'))}">${boards}</div>
      <ol class="ex-list" aria-label="${esc(t('examples.listLabel', { device: getTarget(device)?.name || device }))}">${items}</ol>`
  }

  /** Open a starter project, asking first if there are blocks to lose. */
  async _openExamples() {
    let device = this.workspace.targetId || this.pickedTarget
    if (!EXAMPLE_DEVICES.includes(device)) device = EXAMPLE_DEVICES[0]
    let chosen = null
    const closed = showModal({ title: t('examples.title'), bodyHtml: this._examplesHtml(device), confirmText: t('examples.close') })
    const dialog = $('modal')
    const onClick = (e) => {
      const board = e.target.closest('[data-ex-device]')
      if (board) {
        device = board.dataset.exDevice
        dialog.querySelector('.modal-body').innerHTML = this._examplesHtml(device)
        dialog.querySelector(`[data-ex-device="${device}"]`).focus()
        return
      }
      const item = e.target.closest('[data-example]')
      if (item) {
        chosen = item.dataset.example
        dialog.close('example')
      }
    }
    dialog.addEventListener('click', onClick)
    await closed
    dialog.removeEventListener('click', onClick)
    if (!chosen) return

    if (!this.workspace.isEmpty) {
      const ok = await showModal({
        title: t('examples.replaceTitle'),
        bodyHtml: t('examples.replaceBodyHtml'),
        confirmText: t('examples.replace'),
        cancelText: t('pick.keep'),
      })
      if (!ok) return
    }
    const project = exampleProject(device, chosen)
    const goal = t(`example.${device}.${chosen}.goal`)
    this.workspace.clear()
    this.workspace.loadProject(project)
    this.workspace.workspace.cleanUp()
    this.pickedTarget = device
    localStorage.setItem(PICKED_DEVICE, device)
    this._renderDevicePicker()
    this._refreshDeviceChip()
    this.terminal.say(t('examples.opened', { name: project.name, goal }))
    toast({ kind: 'info', title: t('opened.title'), detail: goal })
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
