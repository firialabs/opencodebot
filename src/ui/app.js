/** Wires the workspace, the board and the chrome around them together. */
import { State, createDevice, deviceKindFromUrl } from '../device/device-target.js'
// Each import registers a kind of device. Add a simulator the same way.
import '../device/device-manager.js'
import '../device/loopback-device.js'
import { SUPPORTED_TARGETS, getTarget } from '../device/targets.js'
import { FLAVORS, flavorEvents, genericFlavor, setGenericFlavor } from '../device/flavor.js'
import * as Blockly from 'blockly/core'
import { BlockWorkspace, STARTER_PROJECTS, fileNameFor } from '../workspace/workspace.js'
import { generatePython, generateWithLines, devicesUsed, boardOfPython } from '../blocks/index.js'
import { TerminalPanel } from './terminal.js'
import { toast, showModal, choose } from './notify.js'
import { examplesFor, exampleProject, EXAMPLE_DEVICES } from '../examples/index.js'
import { t, listOf, LANGUAGES, language, languageName, machineNote, setLanguage } from '../i18n/index.js'
import { BRAND } from '../brand.js'
import { DeviceSwitch } from '../sim/device-switch.js'
import { SimDevice } from '../sim/sim-device.js'   // registers the 'sim' kind
import { SimPanel } from '../sim/sim-panel.js'
import { LazyPythonEditor } from '../editor/lazy-editor.js'
import { SnippetPalette } from '../editor/palette.js'
import { pythonToBlocks } from '../convert/to-blocks.js'
import { createFileStores } from '../files/store.js'
import { companionsOf, CopiedFiles, copyable } from '../files/companions.js'
import { createMyBlocksStore } from '../my-blocks/store.js'
import { installMyBlocks } from '../my-blocks/blocks.js'
import { FilesPanel } from './files-panel.js'
import { Learn, DEMO_PACK } from '../learn/learn.js'
import { fileOf } from '../learn/journey/journey.js'
import { installCodeTrek } from '../learn/trek-blocks.js'
import { trekSnippets } from '../learn/trek.js'
import { installPaletteSize } from './palette-size.js'
import { esc } from '../learn/esc.js'
import { BANNER } from '../blocks/generate.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1' // been here before: Welcome back
const GUIDE_LEFT = 'opencodebot.guideLeft.v1' // { 'store:path': the program the demo last left in that file }
const WELCOME = 'opencodebot.welcome.v1' // 'off': no welcome (tests, kiosks)
const DEMO_ASKED = 'opencodebot.demoAsked' // this tab chose Try a Demo! and the demo has not opened yet (a reload on the way keeps the choice)
const DEMO_ASKED_MS = 120_000
const PICKED_DEVICE = 'opencodebot.device.v1'
const TERMINAL_PANEL = 'opencodebot.terminalPanel.v1'
const OPEN_FILE = 'opencodebot.openFile.v1'
const LAYOUTS = 'opencodebot.layouts.v1'
/** The panels as the student left them: { sim: was the simulator on, sideW / sideH: the side's width, or height on a narrow screen }. */
const PANELS = 'opencodebot.panels.v1'
/**
 * A student's first file. main.py is only the board's name for the program
 * Run sends; on the page a program is always a file of the student's own.
 * Files made before (main.py included) keep their names.
 */
const FIRST_FILE = 'my_program.py'
const TAB_LOCK = 'opencodebot.editing'
/** How many of a board's examples, easiest first, Learn shows as quick starts. */
const QUICK_STARTS = 2
/** This build: package.json's version and the commit, filled in by vite.config.js. */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'

/** A path's last part: its file name. */
const baseName = (path) => path.split('/').pop()
/**
 * Are two programs the same, but for the header blocks write at a program's
 * top (the banner, the device), blank lines and spaces at line ends? Anything
 * else, a student's comment or note included, makes them different: a
 * program judged the same is replaced without being kept.
 */
const sameProgram = (a, b) => {
  const generated = (l) => l === BANNER || l.startsWith('# Device: ')
  const plain = (py) => py.split('\n').map((l) => l.trimEnd()).filter((l) => l && !generated(l)).join('\n')
  return plain(a) === plain(b)
}

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    // The kind the page was opened with (?device=) is the board; the simulator
    // sits beside it, behind Simulate. ?device=sim opens in the simulator.
    const kind = deviceKindFromUrl()
    this.device = new DeviceSwitch(createDevice(kind === 'sim' ? 'serial' : kind), createDevice('sim'))
    // The program's other .py files, as copied to the board before a run (_copyCompanions).
    this.copiedFiles = new CopiedFiles()
    this.simPanel = new SimPanel($('sim-host'), this.device.sim)
    this.pickedTarget = localStorage.getItem(PICKED_DEVICE) || null

    this.workspace = new BlockWorkspace($('blockly-root'), this.pickedTarget)
    // The student's own saved Python blocks, in this browser, for every project.
    this.myBlocks = createMyBlocksStore()
    installMyBlocks(this.workspace.workspace, this.myBlocks, {
      saved: () => toast({ kind: 'info', title: t('myBlocks.saved'), detail: t('myBlocks.savedDetail') }),
    })
    this.terminal = new TerminalPanel($('terminal-host'), (data) => this.device.sendRaw(data))
    // Mission packs: the rail at the right of the work area, and the tutorial's drawer.
    this.learn = new Learn({
      pane: $('learn-pane'),
      rail: $('learn-rail'),
      workarea: document.querySelector('.workarea'),
      onResize: () => this._refitSide?.(),
      device: this.device,
      program: () => this._currentPython(),
      connectedProgram: () => this._connectedPython(),
      onTrek: (trek) => this._showTrek(trek),
      blocksFromPython: (python, board) => pythonToBlocks(python, board),
      toPython: () => this.workspace.mode === 'text' || this._toText(),
      blocks: this.workspace,
      simView: () => this.device.sim.view ?? null,
      // The Python view on show: the coach points into its editor and palette.
      pythonView: () => (this.view === 'python' ? { editor: this.pythonEditor, palette: this.palette } : null),
      useFile: (where) => this._missionFile(where),
      switchMode: (mode) => ((mode === 'python') !== (this.workspace.mode === 'text') ? this._toggleView() : null),
      prepare: (how) => this._prepareRun(how),
      stage: (step, how) => this._stage(step, how),
      startSim: ({ room, course, camera }) => {
        const sim = this.device.sim
        if (room) sim.setRoom(room)
        if (course !== undefined) sim.setCourse(course)
        if (camera) sim.setCamera(camera.mode, { turn: camera.turn ?? null })
      },
      onOpen: (open) => this._showLearnOpen(open),
      simStage: () => document.querySelector('#sim-host .sim-stage'),
    })
    // What the demo leaves in its file, so the next demo replaces it without asking when the student has not changed it since.
    this.learn.journey.addEventListener('progress', () => this._keepGuideLeft())
    // The open objective's CodeTrek, in the block palette (and the Python one, below).
    this.trek = null
    this.codeTrek = installCodeTrek(this.workspace, { used: () => this.learn.event('trek-used') })
    $('pack-input').addEventListener('change', (e) => {
      this.learn.openFile(e.target.files?.[0])
      e.target.value = ''
    })

    this._bindDevice()
    this._bindFlavor()
    this._bindChrome()
    // A paused program's line, on its block and in the Python view.
    this.device.sim.addEventListener('line', (e) => this._showLine(e.detail.line))
    // A click on a part of the simulated board, for a mission's `pick` goal.
    this.device.sim.addEventListener('pick', (e) => this.learn.pick(e.detail))
    // Turning the simulator's camera, and opening a palette category: a journey's `orbit` and `palette` events.
    this.device.sim.addEventListener('orbit', () => this.learn.event('orbit'))
    this.workspace.workspace.addChangeListener((e) => {
      if (e.type !== Blockly.Events.TOOLBOX_ITEM_SELECT || !e.newItem) return
      // The event names the category by its words; a journey names it by its id (`lights`).
      const item = this.workspace.workspace.getToolbox()?.getToolboxItems().find((i) => i.getName?.() === e.newItem)
      this.learn.event('palette', item?.getId() ?? e.newItem)
    })
    this._bindWorkspace()
    this._bindTextMode()
    // Both palettes small or full, for small screens.
    installPaletteSize({ root: document.querySelector('.editor-main'), button: $('btn-palette-size'), onChange: () => this.workspace.resize() })

    if (!this.workspace.restore() && this.pickedTarget) {
      this.workspace.loadProject(STARTER_PROJECTS[this.pickedTarget] || { blocks: {} })
    }
    // After the restore: bringing back the saved project does not close the open file.
    this._bindFiles()
    this._showMode()

    this._greet()
    this._renderDevicePicker()
    this._renderLanguages()
    this._refreshDeviceChip()
    this._checkBrowser()
    // The welcome first; then the demo, or the mission pack the student was in, if any.
    this._welcome()
      .then(async (demo) => {
        if (!demo) return this.learn.restore()
        await this.learn.openDemo()
        try {
          sessionStorage.removeItem(DEMO_ASKED)
        } catch {
          // nothing was kept
        }
      })
      .catch((err) => console.warn('learn', err))

    // A board that is already plugged in and paired can just come back.
    this.device.autoConnect().catch(() => {})
    // The simulator comes back if it was on when the page went (a board plugged in takes over, as ever).
    if (kind === 'sim' || panels().sim) this._toggleSimulate()
  }

  /** The CodeTrek of the objective on show (null for none), in both palettes. */
  _showTrek(trek) {
    this.trek = trek
    this.codeTrek.set(trek)
    this.palette?.refresh()
  }

  _greet() {
    this.terminal.show(`\x1b[32m${t('term.greeting')}\x1b[0m\r\n\x1b[90m${t('term.greetingHint')}\x1b[0m\r\n`)
  }

  // ------------------------------------------------------------- device

  _bindDevice() {
    const device = this.device

    device.addEventListener('data', (e) => this.terminal.write(e.detail))

    device.addEventListener('state', (e) => {
      const { state, message } = e.detail
      this._setStatus(state, message)
      keepPanels({ sim: this.device.simulating })
      this._refreshButtons()
      this._refreshDeviceChip()
      this._refreshSide()
    })

    device.addEventListener('device', (e) => {
      // Another board, or a new simulator: what was copied before may not be there.
      this.copiedFiles = new CopiedFiles()
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

  /**
   * The MicroPython / CircuitPython board's flavor changed (its banner said, or
   * the student chose in the device menu): its Pins blocks, both palettes and
   * its name in the chip follow.
   */
  _bindFlavor() {
    flavorEvents.addEventListener('change', (e) => {
      if (this.workspace.targetId !== 'generic') return
      this.workspace.refreshToolbox()
      this.palette?.refresh()
      this._renderDevicePicker()
      this._refreshDeviceChip()
      if (e.detail.from === 'board') {
        const name = getTarget('generic').name
        toast({ kind: 'info', title: t('flavor.followTitle', { flavor: name }), detail: t('flavor.followDetail', { flavor: name }) })
      }
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
    // A board on USB gives way to the simulator, once the student agrees.
    if (this.device.isConnected && !(await this._confirmLeave(t('leave.toSim')))) return
    this._roomForSim()
    await this.device.simulate(target)
    this._refreshSimButton()
  }

  /** Ask before leaving the board in use (on USB or in the simulator) for the other kind; its program stops. */
  _confirmLeave(confirmText) {
    const sim = this.device.simulating
    const device = getTarget(this.device.targetId)?.name || ''
    return showModal({
      title: t(sim ? 'leave.simTitle' : 'leave.boardTitle', { device }),
      bodyHtml: t(this.device.state === State.RUNNING ? 'leave.runningBodyHtml' : 'leave.bodyHtml', { device }),
      confirmText,
      cancelText: t(sim ? 'leave.keepSim' : 'leave.keepBoard', { device }),
    })
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
    // The simulator gives way to a board on USB, once the student agrees.
    if (this.device.simulating && !(await this._confirmLeave(t('leave.toBoard')))) return
    const ok = await this.device.connect()
    this._refreshSimButton()
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

    // A MicroPython / CircuitPython board says which it is before its program is written.
    if (!this.device.simulating) await this.device.board.identify?.()
    // Typed Python runs as typed, with no blocks behind its lines (line n is
    // the editor's line n); the blocks' Python knows which block made each line.
    const { code, blockAt } = textMode
      ? { code: this.workspace.pythonText, blockAt: {} }
      : generateWithLines(this.workspace.workspace, this.workspace.targetId)
    this._ran = { code, blockAt, text: textMode }
    if (!(await this._copyCompanions())) return
    // The mission drawer gets out of the way of the simulator and the terminal; the rail brings it back.
    this.learn.collapse()
    this.terminal.say(t('term.sending'))
    await this.device.run(code)
  }

  /**
   * The open program's companion files (files/companions.js) onto the board
   * or the simulator's drive, before it runs: the other .py files in its
   * folder, the ones changed since they were last copied there. Says what it
   * copied and what it would not. False if a copy failed (the run waits).
   */
  async _copyCompanions() {
    const f = this.openFile
    const store = f && this.stores[f.store]
    // With no board, Run itself says so.
    if (!store || !this.device.isConnected) return true
    // A MicroPython / CircuitPython board's files are the student's own (a
    // driver, a config.py), and a CircuitPython drive is read-only to code
    // anyway: nothing is copied there. Say so once, if there was anything to copy.
    if (this.device.targetId === 'generic') {
      if (!this._saidNoCopy) {
        const { files } = await companionsOf(store, f.path).catch(() => ({ files: [] }))
        if (files.length) {
          this._saidNoCopy = true
          toast({ kind: 'info', title: t('run.genericNoCopyTitle'), detail: t('run.genericNoCopyDetail', { files: files.map((x) => x.name).join(', ') }) })
        }
      }
      return true
    }
    let found
    try {
      found = await companionsOf(store, f.path)
    } catch (err) {
      // The folder cannot be read (a folder on the computer not allowed again yet): the
      // program runs, but say its other files were not copied.
      console.warn('companions', err)
      toast({ kind: 'warn', title: t('run.folderUnreadTitle'), detail: t('run.folderUnreadDetail') })
      return true
    }
    if (found.refused.length) {
      toast({ kind: 'warn', title: t('run.notCopiedTitle'), detail: t('run.notCopiedDetail', { files: found.refused.join(', ') }) })
    }
    const board = `${this.device.kind}:${this.device.targetId}`
    const changed = this.copiedFiles.changed(board, found.files)
    for (const file of changed) {
      if (!(await this.device.writeFile(file.name, file.text))) {
        toast({ kind: 'error', title: t('run.copyFailedTitle', { file: file.name }), detail: t('run.copyFailedDetail') })
        return false
      }
      this.copiedFiles.copied(board, [file])
    }
    if (changed.length) this.terminal.say(t('run.copied', { files: changed.map((x) => x.name).join(', ') }))
    return true
  }

  // Mark the line a paused program is at (null: none): typed Python's line in
  // the editor, while it still holds the program that runs; else on its block.
  _showLine(line) {
    const ws = this.workspace.workspace
    const id = line && this._ran?.blockAt[line]
    ws.highlightBlock?.(id && ws.getBlockById(id) ? id : null)
    if (this._ran?.text) {
      const editor = this.pythonEditor
      editor.showLine(line && editor.value === this._ran.code ? line : null)
    }
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
    if (this.device.simulating && this.device.state === State.RUNNING) {
      this.device.sim.stepLine()
      this.learn.event('stepped')
    }
  }

  // ------------------------------------------------------------ chrome

  _bindChrome() {
    // While a mission pack is open, Learn is the way out of it.
    $('btn-learn').addEventListener('click', () => (this.learn.isOpen && this.learn.guided ? this.learn.close() : this._openLearn()))
    $('btn-connect').addEventListener('click', () => this._toggleConnect())
    $('btn-sim').addEventListener('click', () => this._toggleSimulate())
    $('btn-run').addEventListener('click', () => this._run())
    $('btn-stop').addEventListener('click', () => this._stop())
    $('btn-pause').addEventListener('click', () => this._togglePause())
    $('btn-step').addEventListener('click', () => this._step())
    $('btn-clear-term').addEventListener('click', () => this.terminal.clear())
    $('btn-term-toggle').addEventListener('click', () => this._setTermOpen(!this.termOpen))
    // The browser tab shows the program's file.
    this.workspace.addEventListener('rename', () => {
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

    $('file-input').addEventListener('change', (e) => this._importFile(e.target.files?.[0]))

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
          this._saveNow()
        }
      },
      true,
    )
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.device.state === State.RUNNING && !$('python-editor').contains(e.target)) {
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

  /** The Learn button says Exit tutorial while a guided mission pack is open, so it is plain the student is in one, and how to leave. */
  _showLearnOpen(open) {
    const b = $('btn-learn')
    b.dataset.open = String(open)
    b.querySelector('.btn-text').textContent = t(open ? 'btn.exitTutorial' : 'btn.learn')
    b.querySelector('.btn-emoji').textContent = open ? '🚪' : '🧭'
    b.title = t(open ? 'btn.exitTutorialTitle' : 'btn.learnTitle')
  }

  /**
   * A guided mission's board, as the student chose to run it: `runOn` 'sim',
   * the mission's board in the simulator (a board already on USB is left as
   * it is: it is what the student has); 'usb', their board connected. False
   * when the board on USB did not connect.
   */
  async _prepareRun({ board, runOn }) {
    if (runOn === 'usb') {
      if (this.device.isConnected && !this.device.simulating) return true
      if (this.device.simulating) await this.device.disconnect()
      const ok = await this.device.connect()
      this._refreshSimButton()
      return ok
    }
    if (this.device.isConnected && !this.device.simulating) return true
    if (board && this.workspace.targetId !== board) await this._pickTarget(board)
    if (!this.device.simulating) await this._toggleSimulate()
    return this.device.simulating
  }

  /**
   * Before a guided step: what it points at, on screen. The files panel and
   * menus shut; the simulator back if the student chose it and it went; the
   * side wide enough to see it; the terminal open when the step is about it.
   * `step` null is a card over the simulator.
   */
  _stage(step, { board, runOn }) {
    if (!$('files-panel').hidden) this._toggleFiles(false)
    this._togglePopover($('device-chip'), $('device-menu'), false)
    this._togglePopover($('btn-menu'), $('app-menu'), false)
    const usb = this.device.isConnected && !this.device.simulating
    if (runOn === 'sim' && !usb && !this._staging && (!this.device.simulating || this.device.targetId !== board)) {
      this._staging = this._prepareRun({ board, runOn }).finally(() => (this._staging = null))
    }
    const kind = (step?.point || 'sim').split(':')[0]
    if (['sim', 'part', 'terminal'].includes(kind)) this._roomForSide(kind)
    if (kind === 'terminal' && !this.termOpen) this._setTermOpen(true)
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
        const width = Math.min(Math.max(px, 220), rect.width - 280 - this.learn.width)
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
    // The size the student chose is kept, for the next visit.
    const chosen = (px) => {
      setSide(px)
      keepPanels({ [vertical() ? 'sideH' : 'sideW']: Math.round(sideNow()) })
    }
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const rect = workarea.getBoundingClientRect()
      chosen(vertical() ? rect.bottom - e.clientY : rect.right - e.clientX)
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
      chosen(sideNow() + grow[e.key])
    })
    requestAnimationFrame(() => setSide(panels()[vertical() ? 'sideH' : 'sideW'] || sideNow()))
    // The mission rail came or went: the side fits again.
    this._refitSide = () => setSide(sideNow())

    // On a narrow screen the side is a strip under the blocks: the simulator
    // and the terminal both need more of it, so starting the simulator grows it.
    this._roomForSim = () => {
      if (!vertical()) return
      const want = workarea.getBoundingClientRect().height * 0.6
      if (sideNow() < want) setSide(want)
    }

    // A guided step about the simulator or the terminal: the side wide enough
    // to see them (not kept as the student's choice), and the simulator at least
    // as tall as the terminal when the step is about the board.
    this._roomForSide = (kind) => {
      const rect = workarea.getBoundingClientRect()
      if (vertical()) this._roomForSim()
      else if (sideNow() < Math.max(380, rect.width * 0.34)) setSide(Math.max(380, rect.width * 0.34))
      if (kind !== 'terminal' && this.termOpen && this.device.simulating) {
        const room = $('side-pane').getBoundingClientRect().height
        if (this.termHeight > room * 0.45) {
          this.termHeight = Math.round(room * 0.4)
          this._fitTerm()
        }
      }
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
      if (target.id === 'generic' && this.workspace.targetId === 'generic') menu.appendChild(this._flavorSwitch())
    }
  }

  /**
   * MicroPython or CircuitPython, for the board picked: set by hand before a
   * board is connected (a connected board's banner sets it, flavor.js).
   */
  _flavorSwitch() {
    const row = document.createElement('div')
    row.className = 'dm-flavor'
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', t('flavor.label'))
    row.innerHTML = '<span class="dm-flavor-label"></span>'
    row.firstChild.textContent = t('flavor.label')
    for (const flavor of FLAVORS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = t(`flavor.${flavor}`)
      b.setAttribute('aria-pressed', String(genericFlavor() === flavor))
      b.addEventListener('click', () => setGenericFlavor(flavor, 'student'))
      row.appendChild(b)
    }
    return row
  }

  async _pickTarget(targetId) {
    // In the simulator another board just takes the place of the one loaded
    // (its program stops). Only a real board plugged in cannot be swapped here.
    const resimulate = this.device.simulating && this.device.targetId !== targetId
    if (resimulate) await this.device.disconnect()
    else if (this.device.isConnected && this.device.targetId && this.device.targetId !== targetId) {
      toast({
        kind: 'warn',
        title: t('pick.otherTitle'),
        detail: t('pick.otherDetail', { device: getTarget(this.device.targetId)?.name }),
      })
      return
    }

    // Nothing asks, and nothing of the student's is thrown away: an empty
    // canvas, or the old board's starter just as it came, becomes the new
    // board's starter; any other program stays as it is (saved in this
    // browser), for the student to keep or to swap for another file. Blocks
    // the new board cannot run are named in a toast. (In text mode Run sends
    // the typed Python, so blocks for another board do not matter.)
    const startFresh = this.workspace.isEmpty || this.workspace.isStarter
    const strays =
      startFresh || this.workspace.mode === 'text'
        ? []
        : [...devicesUsed(this.workspace.workspace)].filter((id) => id !== targetId)

    this.pickedTarget = targetId
    localStorage.setItem(PICKED_DEVICE, targetId)
    this.workspace.setTarget(targetId)
    if (startFresh) {
      this.workspace.clear()
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
    } else if (strays.length) {
      toast({
        kind: 'info',
        title: t('switched.title', { device: getTarget(targetId)?.name }),
        detail: t('switched.detail', { names: deviceNames(strays) }),
      })
    }
    this._renderDevicePicker()
    this._refreshDeviceChip()
    if (resimulate) await this._toggleSimulate()
    else this._refreshSimButton()
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
    // The MicroPython / CircuitPython board opens any serial port; the others only theirs.
    this.device.board.setPick?.(this.workspace.targetId)
    this.workspace.addEventListener('change', () => {
      this.device.board.setPick?.(this.workspace.targetId)
      this._refreshHint()
      // Another board, another palette (rebuilt only when the board changed).
      if (this.view === 'python') this.palette.render(this.workspace.targetId)
      clearTimeout(timer)
      timer = setTimeout(() => {
        this.workspace.save()
        this._fileChanged()
      }, 250)
    })
  }

  /**
   * The program as Python, as its file keeps it: typed Python in text mode;
   * else the blocks', except that Python turned into blocks and only looked
   * at stays exactly as it was typed.
   */
  _currentPython() {
    if (this.workspace.mode === 'text') return this.workspace.pythonText
    const python = this._blocksPython()
    const back = this._typedBack
    return back && back.python === python ? back.text : python
  }

  /**
   * The program a guide's step checks: in blocks, only the blocks snapped
   * into it. A stack that hangs from no hat block (the program's start, a
   * function, an event) is not in the program yet: a block being dragged in,
   * or one dropped loose beside it. With no hat block at all, every block is.
   */
  _connectedPython() {
    if (this.workspace.mode === 'text') return this._currentPython()
    const ws = this.workspace.workspace
    const tops = ws.getTopBlocks(false)
    const loose = new Set(tops.filter((b) => b.previousConnection || b.outputConnection).map((b) => b.id))
    if (!loose.size || loose.size === tops.length) return this._currentPython()
    const state = Blockly.serialization.workspaces.save(ws)
    state.blocks.blocks = state.blocks.blocks.filter((b) => !loose.has(b.id))
    const scratch = new Blockly.Workspace()
    try {
      Blockly.serialization.workspaces.load(state, scratch, { recordUndo: false })
      return generatePython(scratch, this.workspace.targetId)
    } catch {
      return this._currentPython()
    } finally {
      scratch.dispose()
    }
  }

  _blocksPython() {
    return generatePython(this.workspace.workspace, this.workspace.targetId)
  }

  _refreshHint() {
    $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.view === 'python'
  }

  // ------------------------------------------------------- blocks or text

  _bindTextMode() {
    // CodeMirror comes in the first time Python is shown (_showMode).
    this.pythonEditor = new LazyPythonEditor($('python-editor'), {
      label: t('text.editorLabel'),
      describedBy: 'python-editor-help',
      onChange: (text) => this.workspace.setPythonText(text),
      // Lines that would become grey Python blocks; none while the code does not parse.
      noBlockLines: (text) => {
        const result = this.blocksFromPython(text)
        return result.ok ? result.pythonLines : []
      },
    })
    this.palette = new SnippetPalette($('py-palette'), {
      editor: () => this.pythonEditor,
      beforeUse: () => {},
      myBlocks: () => this.myBlocks.list(),
      trek: () => (this.trek ? trekSnippets(this.trek) : []),
      used: (snippet) => snippet.trek && this.learn.event('trek-used'),
      opened: (id) => this.learn.event('palette', id),
    })
    this.myBlocks.addEventListener('change', () => this.palette.refresh())
    $('btn-view').addEventListener('click', () => this._toggleView())
    this.workspace.addEventListener('mode', () => this._showMode())
  }

  /** The Python view: the program as Python, there to edit. */
  _toText() {
    // Python that came to blocks and was only looked at comes back exactly
    // as it was typed; once the blocks change, the blocks' Python it is.
    const back = this._typedBack
    const python = this._blocksPython()
    this.workspace.setMode('text', back && back.python === python ? back.text : python)
    this._typedBack = null
    this.pythonEditor.focus()
  }

  /**
   * Work in a journey's file (journey.js, fileOf): `folder`/`file` in the
   * store the student works in (their folder on the computer, else this
   * browser), opened, the file before it saved first. A new file is made from
   * `code`, or with none from the program on show when `carry`. A file there
   * already opens as the student left it, unless `code` is given and the file
   * holds something else: then they choose to save theirs under another name
   * (offered, and theirs to change) or replace it with `code`. Nothing of
   * theirs is lost without that choice. True once the file is open.
   */
  _missionFile(where) {
    // One at a time: a second (a quick click on the rail) waits for the first, so each sees the file open as it is.
    const run = (this._missionTurn || Promise.resolve()).then(() => this._missionFileNow(where))
    this._missionTurn = run.catch(() => {})
    return run
  }

  async _missionFileNow({ folder, file, code = null, carry = false }) {
    if (!this._canWrite()) return false
    // A program blocks cannot show is not loaded in blocks: nothing changes.
    if (code !== null && this.workspace.mode !== 'text' && !this.blocksFromPython(code).ok) {
      toast({ kind: 'error', title: t('missionFile.failed', { name: file }) })
      return false
    }
    const f = this.openFile
    const kind = f?.store === 'folder' && this.stores.folder?.name === f.folder ? 'folder' : 'browser'
    const store = this.stores[kind]
    const path = `${folder}/${file}`
    const open = f?.store === kind && f.path === path
    const fail = (err) => {
      toast({ kind: 'error', title: t('missionFile.failed', { name: file }), detail: err?.message })
      return false
    }
    let text = open ? this._currentPython() : null
    if (!open) {
      try {
        text = await this._inTurn(async () => ((await store.exists(path)) ? store.read(path) : null))
      } catch (err) {
        return fail(err)
      }
    }
    if (text === null) {
      const start = code ?? (carry ? this._currentPython() : '')
      const made = await this._inTurn(async () => {
        try {
          if (!(await store.exists(folder))) await store.mkdir(folder)
          await store.write(path, start)
          return true
        } catch (err) {
          return fail(err)
        }
      })
      return made && this._openFile(kind, path, start)
    }
    if (code === null || sameProgram(text, code)) return open || this._openFile(kind, path, text)

    // A file of that name holds something else: the student's choice, unless it is only what the demo left there.
    const other = await this._freeName(store, folder, file)
    const left = this.learn.journey.pack?.id === DEMO_PACK ? guideLeft()[this._guideKey(kind, path)] : null
    const how = left != null && sameProgram(text, left) ? 'replace' : await choose({
      title: t('missionFile.title', { name: file }),
      bodyHtml: `${t('missionFile.bodyHtml', { name: esc(file) })}
        <label class="save-as"><span>${esc(t('missionFile.newName'))}</span> <input id="mission-save-as" type="text" value="${esc(other)}" spellcheck="false" autocomplete="off"></label>`,
      choices: [
        { value: 'save', label: t('missionFile.saveAs'), primary: true },
        { value: 'replace', label: t('missionFile.replace') },
      ],
    })
    if (!how) return false
    if (how === 'save') {
      const typed = document.getElementById('mission-save-as')?.value ?? ''
      let name = pythonName(typed) || other
      if (name === file || (await store.exists(`${folder}/${name}`))) name = other
      // Theirs moves to its new name, open or not, with its blocks' layout; then the name is free.
      const moved = await this._renameEntry(kind, path, `${folder}/${name}`)
      if (moved) return fail({ message: moved })
      toast({ kind: 'info', title: t('missionFile.savedTitle', { name }), detail: t('missionFile.savedBody', { folder }) })
      if (this.openFile?.store === kind && this.openFile.path === `${folder}/${name}`) {
        // It was the open one: the mission's code goes into a new file of the old name, and that opens.
        const made = await this._inTurn(async () => {
          try {
            await store.write(path, code)
            return true
          } catch (err) {
            return fail(err)
          }
        })
        return made && this._openFile(kind, path, code)
      }
    } else if (this.openFile?.store === kind && this.openFile.path === path) {
      // Replaced, as they chose: the open file (still this one, checked after the question) takes the mission's program and saves itself.
      return this._loadProgram(code)
    }
    const written = await this._inTurn(async () => {
      try {
        await store.write(path, code)
        return true
      } catch (err) {
        return fail(err)
      }
    })
    return written && this._openFile(kind, path, code)
  }

  /**
   * The demo met a step: what is in its file now is the demo's, not the
   * student's own. (A mission's file is theirs, done with the guide or not:
   * only the demo, always played from its start, is replaced unasked.)
   */
  _keepGuideLeft() {
    const f = this.openFile
    const j = this.learn.journey
    if (!f || !j.running || j.pack?.id !== DEMO_PACK) return
    // Only the demo's own file: another file opened mid-demo stays the student's.
    const { folder, file } = fileOf(j.item, j.chapter)
    if (f.path !== `${folder}/${file}`) return
    try {
      localStorage.setItem(GUIDE_LEFT, JSON.stringify({ [this._guideKey(f.store, f.path)]: this._currentPython() }))
    } catch {
      // not kept: starting again asks, as before
    }
  }

  /** Where a file is, for the demo's record: its store, the folder's name for one on the computer, and its path. */
  _guideKey(kind, path) {
    return `${kind}:${kind === 'folder' ? `${this.stores.folder?.name}:` : ''}${path}`
  }

  /** Open a file whose text is known, the open one saved first; true once it is open. */
  async _openFile(kind, path, text) {
    const ok = await this._openRef({ store: kind, path }, { text })
    if (!$('files-panel').hidden) await this._renderFiles()
    return ok
  }

  /** A name like `file` not yet taken in `folder`, still one Python can import: light_show_2.py. */
  async _freeName(store, folder, file) {
    const stem = file.replace(/\.py$/i, '')
    for (let n = 2; ; n++) {
      const name = `${stem}_${n}.py`
      if (!(await store.exists(`${folder}/${name}`))) return name
    }
  }

  /** Replace the program with `python`, in the mode the student is in; false when blocks cannot show it (nothing changes). */
  _loadProgram(python) {
    if (this.workspace.mode === 'text') {
      this.workspace.setPythonText(python)
      this.pythonEditor.value = python
    } else {
      const result = this.blocksFromPython(python)
      if (!result.ok) return false
      this.workspace.replaceBlocks(result.state)
    }
    this._fileChanged?.()
    return true
  }

  /** Python as blocks for the picked board: { ok, state } or { ok: false, line }. */
  blocksFromPython(text) {
    return pythonToBlocks(text, this.workspace.targetId)
  }

  /**
   * The typed Python, turned into blocks. Untouched Python keeps the blocks
   * it came from, as they were; code that does not parse stays Python, with
   * the cursor on the line to fix.
   */
  _toBlocks() {
    const typed = this.workspace.pythonText
    if (typed.trim() !== this._blocksPython().trim()) {
      const result = this.blocksFromPython(typed)
      if (!result.ok) {
        this.pythonEditor.showLine(result.line)
        this.pythonEditor.focus()
        toast({
          kind: 'error',
          title: t('text.notParsedTitle'),
          detail: t('text.notParsedDetail', { line: result.line }),
        })
        return false
      }
      this.workspace.replaceBlocks(result.state)
      this._typedBack = { text: typed, python: this._blocksPython() }
    }
    this.workspace.setMode('blocks')
    return true
  }

  /**
   * The editor area shows the blocks or the Python, never both, and the
   * Python is always there to edit: the switch turns the blocks into Python,
   * or the Python back into blocks (staying in Python at a line that does
   * not parse).
   */
  _toggleView() {
    if (this.workspace.mode === 'text') this._toBlocks()
    else this._toText()
  }

  /** Make the screen match the mode: Python is the Python view, blocks the blocks. */
  _showMode() {
    const python = this.workspace.mode === 'text'
    if (python && this.pythonEditor.value !== this.workspace.pythonText) this.pythonEditor.value = this.workspace.pythonText
    if (python) this.pythonEditor.load()
    this.view = python ? 'python' : 'blocks'
    $('code-pane').hidden = !python
    $('blockly-root').hidden = python
    if (python) this.palette.render(this.workspace.targetId)
    $('blocks-pane').classList.toggle('is-python', python)
    $('btn-view').setAttribute('aria-checked', String(python))
    this.learn.setMode(python ? 'python' : 'blocks')
    if (!python) this.workspace.resize()
    this._refreshHint()
  }

  // ------------------------------------------------------------- files

  /**
   * The program is always a file: in this browser's own storage, or in a
   * folder on the computer. The open file is { store, folder, path, saved }:
   * which store ('browser' or 'folder'), the folder's name, where in it, and
   * the text last read or written there. Work saves itself to it a moment
   * after each change, and before another file opens or the board changes;
   * the bar's dot shows while a save is waiting, or has failed.
   */
  _bindFiles() {
    this.stores = createFileStores()
    this.openFile = null
    try {
      const f = JSON.parse(localStorage.getItem(OPEN_FILE)) || null
      // Remembered before there were two stores: a file in a folder.
      this.openFile = f && !f.store ? { ...f, store: 'folder' } : f
    } catch {
      // nothing remembered
    }
    this.filesPanel = new FilesPanel($('files-panel'), {
      stores: this.stores,
      open: (ref) => this._openRef(ref),
      create: (store, path, kind) => this._createEntry(store, path, kind),
      rename: (store, from, to) => this._renameEntry(store, from, to),
      remove: (store, path, kind) => this._removeEntry(store, path, kind),
      attach: () => this._attachFolder(false),
      reopen: () => this._attachFolder(true),
    })
    $('btn-files').addEventListener('click', () => this._toggleFiles())
    $('btn-save-again').addEventListener('click', () => this._saveNow())
    $('btn-use-tab').addEventListener('click', () => this._claimTab(true))
    if (!this.openFile) this._startFile()
    else this._setOpenFile(this.openFile)
    this._claimTab()
  }

  /** The first time: the program as it is becomes my_program.py in this browser. */
  async _startFile() {
    const path = await this._freePath(this.stores.browser, '', FIRST_FILE)
    const text = this._currentPython()
    let saved
    try {
      await this.stores.browser.write(path, text)
      saved = text
    } catch {
      // not written: the dot shows, and the next save tries again
    }
    this._setOpenFile({ store: 'browser', folder: null, path, saved })
  }

  /**
   * One file operation at a time, in order: saves, renames and deletes never
   * overlap, so a save cannot land in the middle of a rename or a delete.
   * Resolves with what `job` gives.
   */
  _inTurn(job) {
    const run = (this._fileQueue || Promise.resolve()).then(job, job)
    this._fileQueue = run.catch(() => {})
    return run
  }

  /** The store a file is in, open and allowed (a folder after a reload is allowed again from a click); null if not. */
  async _storeFor(f, ask) {
    if (f.store === 'browser') return this.stores.browser
    const folder = this.stores.folder
    if (!folder) return null
    if (folder.name === f.folder) return folder
    if (ask && (await folder.remembered()) === f.folder && (await folder.reopen()) === f.folder) return folder
    return null
  }

  /** The program changed: save it to its file a moment later. */
  _fileChanged() {
    this._refreshFile()
    this.learn.programChanged()
    if (this._readOnly) return
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this._save(false), 750)
  }

  /**
   * Save the program to its file, if it differs from what is there, in turn
   * with other file operations. `ask` (from a click or a key) may ask to
   * allow the folder again. A save that fails says so in the bar, loudly,
   * until one works. Resolves true once the file holds the program.
   */
  _save(ask) {
    clearTimeout(this._saveTimer)
    return this._inTurn(() => this._write(ask))
  }

  /** _save's work, for a job already in turn. */
  async _write(ask) {
    if (this._readOnly) return false
    const f = this.openFile
    if (!f) return true
    const text = this._currentPython()
    this._rememberLayout(f, text)
    if (text === f.saved && !this._saveFailed) return true
    const store = await this._storeFor(f, ask)
    let problem = store ? null : t('files.reopenDetail', { folder: f.folder })
    if (store) {
      try {
        await store.write(f.path, text)
      } catch (err) {
        problem = err.message
      }
    }
    if (this.openFile !== f) return !problem // another file opened meanwhile
    if (problem) {
      if (!this._saveFailed || ask) toast({ kind: 'error', title: t('files.saveFailed', { file: baseName(f.path) }), detail: problem })
      this._saveFailed = true
    } else {
      this._saveFailed = false
      this._setOpenFile({ ...f, saved: text })
    }
    this._refreshFile()
    return !problem
  }

  /**
   * Before another file takes the open one's place: save it. If it cannot be
   * saved, stay, unless the student chooses to leave its changes behind.
   */
  async _leaveFile() {
    if (!this._canWrite()) return false
    if (await this._save(true)) return true
    const f = this.openFile
    return showModal({
      title: t('files.unsavedTitle', { file: baseName(f.path) }),
      bodyHtml: t('files.unsavedBodyHtml', { file: baseName(f.path) }),
      confirmText: t('files.leaveAnyway'),
      cancelText: t('files.stay'),
    })
  }

  /** Ctrl+S, or the bar's button after a failed save: save now, and say so. */
  async _saveNow() {
    if (await this._save(true)) {
      const f = this.openFile
      toast({ kind: 'info', title: t('files.savedTitle'), detail: t('files.savedDetail', { file: f.path, folder: this._placeName(f) }) })
    }
  }

  _placeName(f) {
    return f.store === 'browser' ? t('files.thisBrowser') : f.folder
  }

  /**
   * One tab of this browser edits at a time: they share the saved program
   * and the open file, so two would write over each other. The first holds
   * a lock; another only shows the program, with a button to edit there
   * instead, which takes the lock (the first tab then only shows).
   */
  _claimTab(take = false) {
    if (!navigator.locks) return
    navigator.locks
      .request(TAB_LOCK, take ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) return this._setReadOnly(true)
        // Taken from another tab: start again from what that tab saved.
        if (take) location.reload()
        else this._setReadOnly(false)
        return new Promise(() => {}) // held while this tab is open
      })
      .catch(() => this._setReadOnly(true)) // another tab took it
  }

  /** False, and says why, in a tab that only shows the program: nothing may be written from it. */
  _canWrite() {
    if (!this._readOnly) return true
    toast({ kind: 'warn', title: t('tabs.elsewhereTitle'), detail: t('tabs.elsewhereBody') })
    return false
  }

  _setReadOnly(on) {
    this._readOnly = on
    this.workspace.readOnly = on
    if (on) clearTimeout(this._saveTimer)
    $('tab-elsewhere').hidden = !on
    $('btn-files').disabled = on
    $('btn-view').disabled = on
    if (on) this._toggleFiles(false)
  }

  _setOpenFile(file) {
    this.openFile = file
    if (this._readOnly) return this._refreshFile()
    try {
      if (file) localStorage.setItem(OPEN_FILE, JSON.stringify(file))
      else localStorage.removeItem(OPEN_FILE)
    } catch {
      // storage blocked: the file is forgotten on reload, nothing worse
    }
    if (file) this.workspace.rename(baseName(file.path).replace(/\.py$/i, ''))
    this.filesPanel.setCurrent(file)
    this._refreshFile()
  }

  /** The open file's name in the bar, with a dot while the program differs from it, and a loud button while saving fails. */
  _refreshFile() {
    const f = this.openFile
    $('file-name').textContent = f ? baseName(f.path) : ''
    $('btn-files').title = f ? t('files.buttonTitle', { place: `${this._placeName(f)}/${f.path}` }) : t('files.label')
    $('btn-files').setAttribute('aria-label', f ? t('files.buttonLabel', { file: baseName(f.path) }) : t('files.label'))
    $('file-dirty').hidden = !f || (!this._saveFailed && this._currentPython() === f.saved)
    const again = $('btn-save-again')
    again.hidden = !this._saveFailed
    again.textContent = f?.store === 'folder' ? t('files.allowAgain', { folder: f.folder }) : t('files.saveAgain')
    $('editor-bar').classList.toggle('is-failed', !!this._saveFailed)
  }

  async _toggleFiles(show = $('files-panel').hidden) {
    $('files-panel').hidden = !show
    $('btn-files').setAttribute('aria-expanded', String(show))
    this.workspace.resize()
    if (show) await this._renderFiles()
  }

  async _renderFiles() {
    await this.filesPanel.render()
  }

  /** A name like `name` that is not yet taken in `dir`: blink.py, then blink-2.py. */
  async _freePath(store, dir, name) {
    const [stem, ext] = name.match(/^(.*?)(\.[^.]*)?$/).slice(1)
    for (let n = 1; ; n++) {
      const path = `${dir ? `${dir}/` : ''}${n === 1 ? stem : `${stem}-${n}`}${ext || ''}`
      if (!(await store.exists(path))) return path
    }
  }

  /**
   * Work on another file: this one is saved first; the other opens in the
   * view the student is in (as blocks, the way it was left when its Python is
   * unchanged; else from its Python, which stays Python at a line that does
   * not parse). A file whose imports name another board switches to it.
   */
  async _openRef(ref, { text, left = false } = {}) {
    const f = { store: ref.store, folder: ref.store === 'folder' ? this.stores.folder?.name : null, path: ref.path }
    if (!left && !(await this._leaveFile())) return false
    const store = await this._storeFor(f, true)
    try {
      // In turn with saves: a file is never read while it is being written.
      if (text === undefined) text = await this._inTurn(() => store.read(f.path))
    } catch (err) {
      toast({ kind: 'error', title: t('files.openFailed', { file: baseName(f.path) }), detail: err.message })
      return false
    }
    this._followBoard(text)
    this._typedBack = null
    this._saveFailed = false
    const ws = this.workspace
    const layout = this._layoutFor(f, text)
    this._setOpenFile({ ...f, saved: text })
    if (this.view === 'python') {
      // The blocks behind it, for the way back: as it was left, or none yet.
      if (layout) Blockly.serialization.workspaces.load(layout, ws.workspace)
      else ws.workspace.clear()
      ws.setMode('text', text)
      this.pythonEditor.value = text
      this.pythonEditor.focus()
    } else if (layout) {
      ws.setMode('blocks')
      Blockly.serialization.workspaces.load(layout, ws.workspace)
      this._typedBack = { text, python: this._blocksPython() }
    } else {
      const result = this.blocksFromPython(text)
      if (result.ok) {
        ws.setMode('blocks')
        ws.workspace.clear()
        ws.replaceBlocks(result.state)
        ws.workspace.cleanUp()
        this._typedBack = { text, python: this._blocksPython() }
      } else {
        ws.setMode('text', text)
        this.pythonEditor.showLine(result.line)
        toast({ kind: 'error', title: t('text.notParsedTitle'), detail: t('text.notParsedDetail', { line: result.line }) })
      }
    }
    ws.save()
    this._refreshFile()
    return true
  }

  /** The board a program's imports name, if it is not the one picked: switch to it (not while another board is on USB). */
  _followBoard(text) {
    const board = boardOfPython(text)
    if (!board || board === this.workspace.targetId) return
    const name = getTarget(board)?.name
    if (this.device.isConnected && !this.device.simulating) {
      toast({ kind: 'warn', title: t('files.otherBoardTitle', { device: name }), detail: t('pick.otherDetail', { device: getTarget(this.device.targetId)?.name }) })
      return
    }
    this.pickedTarget = board
    localStorage.setItem(PICKED_DEVICE, board)
    this.workspace.setTarget(board)
    this._renderDevicePicker()
    this._refreshDeviceChip()
    toast({ kind: 'info', title: t('switched.title', { device: name }), detail: t('files.boardFromFile', { device: name }) })
  }

  /** Make a file (empty, and open it) or a folder; null, or what went wrong. */
  async _createEntry(storeKind, path, kind) {
    if (!this._canWrite()) return t('tabs.elsewhereTitle')
    const store = this.stores[storeKind]
    if (await store.exists(path)) return t('files.exists', { name: baseName(path) })
    // A new file opens at once: the open one is saved first (or left by choice).
    if (kind === 'file' && !(await this._leaveFile())) return t('files.notLeft')
    try {
      if (kind === 'dir') await store.mkdir(path)
      else await store.write(path, '')
    } catch (err) {
      return err.message
    }
    if (kind === 'file') {
      await this._openRef({ store: storeKind, path }, { text: '', left: true })
      this.learn.event('file-created', baseName(path))
    }
    return null
  }

  /** Rename a file or folder, in turn with saves, the open file following it; null, or what went wrong. */
  _renameEntry(storeKind, from, to) {
    if (!this._canWrite()) return Promise.resolve(t('tabs.elsewhereTitle'))
    const store = this.stores[storeKind]
    clearTimeout(this._saveTimer)
    return this._inTurn(async () => {
      await this._write(true)
      try {
        await store.rename(from, to)
      } catch (err) {
        return err.taken ? t('files.exists', { name: baseName(to) }) : err.message
      }
      const f = this.openFile
      if (f?.store === storeKind && (f.path === from || f.path.startsWith(`${from}/`))) {
        const path = to + f.path.slice(from.length)
        this._moveLayout(f, { ...f, path })
        this._setOpenFile({ ...f, path })
      }
      return null
    })
  }

  async _removeEntry(storeKind, path, kind) {
    if (!this._canWrite()) return
    const ok = await showModal({
      title: t(kind === 'dir' ? 'files.deleteFolderTitle' : 'files.deleteTitle', { name: baseName(path) }),
      bodyHtml: t(kind === 'dir' ? 'files.deleteFolderBodyHtml' : 'files.deleteBodyHtml', { name: baseName(path) }),
      confirmText: t('files.deleteConfirm'),
      cancelText: t('files.cancel'),
    })
    if (!ok) return
    const store = this.stores[storeKind]
    clearTimeout(this._saveTimer)
    // In turn with saves: none waiting can write the open file back after it is gone.
    const gone = await this._inTurn(async () => {
      try {
        await store.remove(path)
      } catch (err) {
        toast({ kind: 'error', title: t('files.deleteFailed', { name: baseName(path) }), detail: err.message })
        return false
      }
      const f = this.openFile
      const open = f?.store === storeKind && (f.path === path || f.path.startsWith(`${path}/`))
      if (open) {
        this._saveFailed = false
        this._setOpenFile(null)
      }
      return open
    })
    if (gone) {
      // The open file went: work on another Python file there, or a new my_program.py.
      const next = (await store.list('')).find((e) => e.kind === 'file' && /\.py$/i.test(e.name))
      if (next) await this._openRef({ store: storeKind, path: next.path })
      else await this._createEntry(storeKind, await this._freePath(store, '', FIRST_FILE), 'file')
    }
    await this._renderFiles()
  }

  /**
   * Use a folder on the computer (or the one used before, allowed again).
   * The program open in this browser can be copied into it, to go on there.
   */
  async _attachFolder(again) {
    if (!this._canWrite()) return
    const folder = this.stores.folder
    const name = again ? await folder.reopen() : await folder.pickFolder()
    if (!name) return
    const f = this.openFile
    if (f?.store === 'browser') {
      const file = baseName(f.path)
      const copy = await showModal({
        title: t('files.copyTitle', { file, folder: name }),
        bodyHtml: t('files.copyBodyHtml', { file, folder: name }),
        confirmText: t('files.copyConfirm'),
        cancelText: t('files.copyKeep'),
      })
      if (copy) {
        clearTimeout(this._saveTimer)
        await this._inTurn(async () => {
          await this._write(true)
          const path = await this._freePath(folder, '', file)
          const text = this._currentPython()
          try {
            await folder.write(path, text)
            this._moveLayout(f, { store: 'folder', folder: name, path }, true)
            this._setOpenFile({ store: 'folder', folder: name, path, saved: text })
          } catch (err) {
            toast({ kind: 'error', title: t('files.saveFailed', { file: path }), detail: err.message })
          }
        })
      }
    } else if (f?.store === 'folder' && f.folder === name && this._saveFailed) {
      await this._save(true)
    }
    await this._renderFiles()
  }

  // Each file's blocks, as they were last laid out, kept in this browser
  // while the file's Python is still what they make: a file made in blocks
  // opens again just as it was left.
  _layoutKey(f) {
    return `${f.store}:${f.folder ?? ''}:${f.path}`
  }

  _layouts() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUTS)) || {}
    } catch {
      return {}
    }
  }

  _keepLayouts(all) {
    // The 40 files most recently worked on.
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 40)
    try {
      localStorage.setItem(LAYOUTS, JSON.stringify(Object.fromEntries(kept)))
    } catch {
      // storage full or blocked: files open from their Python instead
    }
  }

  _rememberLayout(f, text) {
    if (this.workspace.mode === 'text' || this.workspace.hasNoBlocks) return
    const all = this._layouts()
    all[this._layoutKey(f)] = { python: text, blocks: Blockly.serialization.workspaces.save(this.workspace.workspace), at: Date.now() }
    this._keepLayouts(all)
  }

  _layoutFor(f, text) {
    const kept = this._layouts()[this._layoutKey(f)]
    return kept && kept.python === text ? kept.blocks : null
  }

  _moveLayout(from, to, copy = false) {
    const all = this._layouts()
    const kept = all[this._layoutKey(from)]
    if (!kept) return
    all[this._layoutKey(to)] = kept
    if (!copy) delete all[this._layoutKey(from)]
    this._keepLayouts(all)
  }

  // -------------------------------------------------------------- menu

  async _menuAction(action) {
    switch (action) {
      // The examples live in Learn (quick starts, and "More examples"): this is the old way in.
      case 'examples':
        this._openLearn()
        break
      case 'open':
        $('file-input').click()
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
        showModal({
          title: t('about.title'),
          bodyHtml: (machineNote(language) ? t('about.machineHtml') : '') + t('about.betaHtml') + t('about.bodyHtml') + t('about.privacyHtml') + t('about.legalHtml') + t('about.versionHtml', { version: APP_VERSION, build: APP_BUILD }),
        })
        break
      default:
        if (action.startsWith('lang:') && action.slice(5) !== language) setLanguage(action.slice(5))
    }
  }

  /**
   * One item per language in the ⋯ menu, each named in its own language, and
   * one translated by machine saying so under its name, in its own language.
   * While that language is in use, a link to help improve it follows.
   */
  _renderLanguages() {
    const group = $('lang-menu')
    for (const lang of LANGUAGES) {
      const item = document.createElement('button')
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(lang === language))
      item.dataset.action = `lang:${lang}`
      item.lang = lang
      item.textContent = languageName(lang)
      const note = machineNote(lang)
      if (note) {
        const small = document.createElement('span')
        small.className = 'lang-note'
        small.textContent = note
        item.append(' ', small)
      }
      group.append(item)
    }
    if (machineNote(language)) {
      const link = document.createElement('a')
      link.setAttribute('role', 'menuitem')
      link.className = 'lang-improve'
      link.href = BRAND.issues
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.dataset.action = 'improve-translation' // closes the menu, as any item does
      link.textContent = `${t('lang.improve')} ↗`
      group.append(link)
    }
  }

  // ------------------------------------------------------------- examples

  /**
   * The Learn panel: a board switch, then that board's quick starts (its two
   * easiest examples) and, folded away, the rest of its examples; then the
   * mission packs that come with the app, those kept in this browser from
   * a file, and a button to open a pack file.
   */
  _learnHtml(device, moreOpen, { kept, builtins }) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const name = getTarget(device)?.name || device
    const boards = EXAMPLE_DEVICES.map(
      (id) =>
        `<button type="button" class="ex-board" data-ex-device="${id}" aria-pressed="${id === device}">${esc(getTarget(id)?.name || id)}</button>`,
    ).join('')
    const item = (ex, i) =>
      `<li><button type="button" class="ex-item" data-example="${ex.id}"><span class="ex-num" aria-hidden="true">${i + 1}</span><span class="ex-text"><span class="ex-title">${esc(ex.title)}</span><span class="ex-goal">${esc(ex.goal)}</span></span></button></li>`
    const all = examplesFor(device)
    const quick = all.slice(0, QUICK_STARTS).map(item).join('')
    const more = all.slice(QUICK_STARTS).map((ex, i) => item(ex, QUICK_STARTS + i)).join('')
    return `<h3 class="learn-head">${esc(t('learn.quickTitle'))}</h3>
      <p>${esc(t('learn.quickIntro'))}</p>
      <div class="ex-boards" role="group" aria-label="${esc(t('examples.boards'))}">${boards}</div>
      <ol class="ex-list" aria-label="${esc(t('learn.quickLabel', { device: name }))}">${quick}</ol>
      ${more ? `<details class="ex-more"${moreOpen ? ' open' : ''}><summary>${esc(t('learn.more', { device: name }))}</summary>
      <ol class="ex-list" start="${QUICK_STARTS + 1}" aria-label="${esc(t('examples.listLabel', { device: name }))}">${more}</ol></details>` : ''}
      <h3 class="learn-head learn-packs-head">${esc(t('learn.packsTitle'))}</h3>
      <p>${esc(t('learn.packsIntro'))}</p>
      ${(() => {
        const card = (attr, id, title, goal) =>
          `<li><button type="button" class="ex-item" ${attr}="${esc(id)}"><span class="ex-num" aria-hidden="true">📘</span><span class="ex-text"><span class="ex-title">${esc(title)}</span><span class="ex-goal">${esc(goal)}</span></span></button></li>`
        const ours = new Set(builtins.map((p) => p.id))
        const cards = [
          ...builtins.map((p) => card('data-builtin', p.id, p.title, t('learn.builtinGoal', { device: getTarget(p.board)?.name || p.board, brief: p.brief }))),
          ...kept.filter((p) => !ours.has(p.id)).map((p) => card('data-pack', p.id, p.title, p.brief)),
        ]
        return cards.length ? `<ul class="ex-list" aria-label="${esc(t('learn.packsTitle'))}">${cards.join('')}</ul>` : ''
      })()}
      <button type="button" class="btn btn-small btn-quiet learn-open-file" data-pack-file>${esc(t('learn.openFile'))}</button>`
  }

  /**
   * The Learn panel. A picked example opens as a new file beside the open one;
   * a picked pack opens in the tutorial pane.
   */
  async _openLearn() {
    let device = this.workspace.targetId || this.pickedTarget
    if (!EXAMPLE_DEVICES.includes(device)) device = EXAMPLE_DEVICES[0]
    const [kept, builtins] = await Promise.all([this.learn.packs().catch((err) => (console.warn('learn', err), [])), this.learn.builtins()])
    const packs = { kept, builtins }
    let chosen = null
    let pack = null
    let builtin = null
    const closed = showModal({ title: t('learn.title'), bodyHtml: this._learnHtml(device, false, packs), confirmText: t('examples.close') })
    const dialog = $('modal')
    const onClick = (e) => {
      const board = e.target.closest('[data-ex-device]')
      if (board) {
        device = board.dataset.exDevice
        const moreOpen = !!dialog.querySelector('.ex-more')?.open
        dialog.querySelector('.modal-body').innerHTML = this._learnHtml(device, moreOpen, packs)
        dialog.querySelector(`[data-ex-device="${device}"]`).focus()
        return
      }
      const item = e.target.closest('[data-example]')
      if (item) {
        chosen = item.dataset.example
        dialog.close('example')
      }
      const keptCard = e.target.closest('[data-pack]')
      if (keptCard) {
        pack = keptCard.dataset.pack
        dialog.close('pack')
      }
      const ours = e.target.closest('[data-builtin]')
      if (ours) {
        builtin = builtins.find((p) => p.id === ours.dataset.builtin)
        dialog.close('pack')
      }
      if (e.target.closest('[data-pack-file]')) {
        // Within the click, so the browser lets the file picker open.
        $('pack-input').click()
        dialog.close('pack-file')
      }
    }
    dialog.addEventListener('click', onClick)
    await closed
    dialog.removeEventListener('click', onClick)
    if (pack) return this.learn.open(pack)
    if (builtin) return this.learn.openBuiltin(builtin)
    if (!chosen || !this._canWrite()) return

    const project = exampleProject(device, chosen)
    const goal = t(`example.${device}.${chosen}.goal`)
    if (!(await this._openAsNewFile(project, fileNameFor(project.name, 'py')))) return
    this.pickedTarget = device
    localStorage.setItem(PICKED_DEVICE, device)
    this._renderDevicePicker()
    this._refreshDeviceChip()
    this.terminal.say(t('examples.opened', { name: project.name, goal }))
    toast({ kind: 'info', title: t('opened.title'), detail: goal })
  }

  /**
   * A project of blocks (an example, or an old project file) as a new file,
   * beside the open one, which is saved and kept: named `name`, or name-2 if
   * that is taken, in the store the open file is in.
   */
  async _openAsNewFile(project, name) {
    if (!(await this._leaveFile())) return false
    const ws = this.workspace
    const f = this.openFile
    const kind = f?.store === 'folder' && this.stores.folder?.name === f.folder ? 'folder' : 'browser'
    const store = this.stores[kind]
    const dir = f && f.store === kind ? f.path.split('/').slice(0, -1).join('/') : ''
    const path = await this._freePath(store, dir, name)
    // The new file is the open one before its program goes in, with no wait
    // between: a save waiting its turn writes the new program to the new file,
    // never over the one just left.
    clearTimeout(this._saveTimer)
    this._saveFailed = false
    this._typedBack = null
    this._setOpenFile({ store: kind, folder: kind === 'folder' ? store.name : null, path })
    ws.loadProject({ ...project, name: undefined, mode: undefined, python: undefined })
    ws.workspace.cleanUp()
    if (this.view === 'python') ws.setMode('text', this._blocksPython())
    await this._save(true)
    if (!$('files-panel').hidden) await this._renderFiles()
    return true
  }

  /** ⋯ Open a file: a Python file, or a project file from before files were Python, as a new file. */
  async _importFile(file) {
    if (!file) return
    if (!this._canWrite()) {
      $('file-input').value = ''
      return
    }
    try {
      const text = await file.text()
      if (/\.py$/i.test(file.name)) {
        if (!(await this._leaveFile())) return
        const f = this.openFile
        const kind = f?.store === 'folder' && this.stores.folder?.name === f.folder ? 'folder' : 'browser'
        const path = await this._freePath(this.stores[kind], '', file.name)
        await this.stores[kind].write(path, text)
        await this._openRef({ store: kind, path }, { text, left: true })
      } else {
        const project = JSON.parse(text)
        if (!project?.blocks) throw new Error(t('openFailed.notProject'))
        if (!(await this._openAsNewFile(project, fileNameFor(project.name || file.name.replace(/\.\w+$/, ''), 'py')))) return
        if (project.device) {
          this.pickedTarget = project.device
          localStorage.setItem(PICKED_DEVICE, project.device)
        }
        if (project.mode === 'text' && typeof project.python === 'string') {
          this.workspace.setMode('text', project.python)
          this._fileChanged()
        }
        this._renderDevicePicker()
        this._refreshDeviceChip()
      }
      if (!$('files-panel').hidden) await this._renderFiles()
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

  /**
   * The welcome, on every visit: Welcome, or Welcome back with Resume for one
   * who has been here before, and always Try a Demo!. Resolves true when the
   * demo was chosen. `opencodebot.welcome.v1` set to `off` leaves it out (for
   * automated tests, and a kiosk that opens straight to work).
   */
  async _welcome() {
    let back = false
    try {
      if (localStorage.getItem(WELCOME) === 'off') return false
      // Chosen just now, and the page reloaded on its way to the demo (onto a new build, new-build.js): straight in.
      if (Date.now() - Number(sessionStorage.getItem(DEMO_ASKED) || 0) < DEMO_ASKED_MS) return true
      back = !!localStorage.getItem(SEEN_WELCOME)
      localStorage.setItem(SEEN_WELCOME, '1')
    } catch {
      // storage blocked: every visit is a first one
    }
    const how = await choose({
      title: t(back ? 'welcome.backTitle' : 'welcome.title'),
      bodyHtml: t('welcome.bodyHtml'),
      choices: [
        { value: 'go', label: t(back ? 'welcome.resume' : 'welcome.confirm'), primary: true },
        { value: 'demo', label: t('welcome.demo') },
      ],
    })
    if (how === 'demo') {
      try {
        sessionStorage.setItem(DEMO_ASKED, String(Date.now()))
      } catch {
        // storage blocked: a reload on the way asks again
      }
    }
    return how === 'demo'
  }
}

function guideLeft() {
  try {
    return JSON.parse(localStorage.getItem(GUIDE_LEFT)) || {}
  } catch {
    return {}
  }
}

function panels() {
  try {
    return JSON.parse(localStorage.getItem(PANELS)) || {}
  } catch {
    return {}
  }
}

function keepPanels(change) {
  try {
    localStorage.setItem(PANELS, JSON.stringify({ ...panels(), ...change }))
  } catch {
    // storage blocked: the panels start as new next time
  }
}

/** What a student typed as a file's name, as one Python can import and Run may copy ("my game" is my_game.py); '' if none is left. */
function pythonName(typed) {
  const stem = typed.trim().replace(/\.py$/i, '').replace(/\W+/g, '_').replace(/^_+|_+$/g, '')
  const name = stem && `${/^\d/.test(stem) ? `_${stem}` : stem}.py`
  return name && copyable(name) ? name : ''
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
