// A simulated board: a DeviceTarget (docs/device-targets.md) of kind 'sim',
// which the app treats as one more device. Beyond the interface, connect()
// takes the board to simulate, and its own event 'line' gives the program's
// line while paused ({ line }, null when it runs on).
import { State, registerDeviceKind } from '../device/device-target.js'
import { t, language } from '../i18n/index.js'
import { getTarget } from '../device/targets.js'
import { KINDS, ROOMS, MUSIC } from './kinds.js'
import { FLIGHT } from 'virtual:sim-flight'
import { Describer } from './describe.js'
import { Speaker } from './sound.js'

const enc = new TextEncoder()

export class SimDevice extends EventTarget {
  constructor() {
    super()
    this.kind = 'sim'
    this.isSimulator = true
    this.state = State.OFFLINE
    this.targetId = null
    this.firmware = null
    this.busy = false
    this.worker = null
    this.view = null
    this.viewHost = null
    this.cameraMode = 'chase'
    this.course = null             // a line course on the floor (world/courses.js)
    this.room = null               // a room from kinds.js ROOMS; null: the board's own
    this.supported = 'WebAssembly' in globalThis && typeof Worker !== 'undefined'
  }

  get isConnected() {
    return !!this.worker
  }

  get target() {
    return getTarget(this.targetId)
  }

  // CodeAIR needs a build with its flight library (sim/tools/flight-library.mjs).
  static canSimulate(targetId) {
    const kind = KINDS[targetId]
    return !!kind && (!kind.needsFlight || FLIGHT)
  }

  // Why a board cannot be simulated: [title, detail].
  static whyNot(targetId) {
    const device = getTarget(targetId)?.name ?? t('sim.thatDevice')
    if (KINDS[targetId]?.needsFlight) return [t('sim.flightComingTitle', { device }), t('sim.flightComingDetail')]
    return [t('sim.cannotTitle', { device }), t(FLIGHT ? 'sim.noneYetDetail' : 'sim.noneYetDetailNoFlight')]
  }

  // Where the picture goes; set before connect.
  attachView(host) {
    this.viewHost = host
  }

  async connect(targetId = 'codebot') {
    if (this.worker) return true
    if (!SimDevice.canSimulate(targetId)) {
      this._notice('warn', ...SimDevice.whyNot(targetId))
      return false
    }
    this._setState(State.CONNECTING, t('sim.starting'))
    const assetsBase = new URL('sim-assets/', document.baseURI).href
    this.worker = new Worker(new URL('./runtime/worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => this._onMessage(e.data)
    this.worker.onerror = (e) => {
      console.error(e)
      this._notice('error', t('sim.stoppedTitle'), e.message || t('sim.stoppedDetail'))
    }
    this.targetId = targetId
    const kind = KINDS[targetId]
    const room = kind.view === '3d' ? (this.room ?? kind.env) : kind.env
    const ready = new Promise((resolve) => (this._ready = resolve))
    this.worker.postMessage({ t: 'init', kind: targetId, env: room, assetsBase, course: this.course })
    this.speaker = new Speaker()
    this._roomMusic(room)

    if (this.viewHost) {
      if (kind.view === 'codex') {
        const { CodeXFace } = await import('./view/codex-face.js')
        this.view = new CodeXFace(this.viewHost, { onButton: (n, down) => this.press(n, down) })
      } else {
        const { SimView } = await import('./view/view.js')
        this.view = new SimView(this.viewHost, { assetsBase })
        this.view.cameraMode = this.cameraMode
        // a drag or a key took the camera into orbit: the bar shows it
        this.view.onCameraMode = (mode) => {
          this.cameraMode = mode
          this.dispatchEvent(new CustomEvent('camera', { detail: mode }))
        }
        await this.view.loadRoom(room).catch((err) => console.warn('room', err))
      }
    }
    if (this.view) {
      const keys = kind.view === 'codex'
        ? t('sim.keysCodex')
        : t('sim.keys3d')
      this.describer = new Describer(this.viewHost, this.view.focusEl, t('sim.viewLabel', { device: this.target?.name, keys }))
    }
    const snap = await ready
    for (const d of snap.devices) await this.view?.addDevice(d)
    this.view?.setCourse?.(this._course)
    this.view?.push(snap)

    this.firmware = { version: 'simulator', date: '' }
    this.dispatchEvent(new CustomEvent('device', { detail: { targetId, target: this.target } }))
    const hello = kind.view === '3d' ? t('sim.helloInRoom', { device: this.target?.name, room: this._roomName() }) : t('sim.hello', { device: this.target?.name })
    this._emitText(`\x1b[32m${hello}\x1b[0m\r\n`)
    this._setState(State.READY, t('sim.ready'))
    return true
  }

  async disconnect() {
    this.worker?.terminate()
    this.worker = null
    this.view?.dispose()
    this.view = null
    this.describer?.dispose()
    this.describer = null
    this.speaker?.close()
    this.speaker = null
    this.setMusic(null)
    this.targetId = null
    this.busy = false
    this.dispatchEvent(new CustomEvent('device', { detail: { targetId: null, target: null } }))
    this._setState(State.OFFLINE, t('sim.closed'))
  }

  // stepFirst: pause at the program's first line, to step it by line.
  async run(source, { stepFirst = false } = {}) {
    if (!this.worker) return false
    if (this.state === State.RUNNING) {
      await this.stop()
    }
    this._post({ t: 'run', source, stepFirst })
    this._setState(State.RUNNING, t('sim.running'))
    return true
  }

  async stop() {
    if (!this.worker || this.state !== State.RUNNING) return true
    const done = new Promise((r) => (this._stopped = r))
    this._post({ t: 'stop' })
    await done
    return true
  }

  // Save a file on the simulated board's drive; programs run after can open it.
  async writeFile(name, contents) {
    if (!this.worker) return false
    const saved = new Promise((r) => ((this._saved ??= new Map()).set(name, r)))
    this._post({ t: 'file', name, contents })
    await saved
    return true
  }

  // Held still by pause or a step, while its program runs.
  get paused() { return this.state === State.RUNNING && !!this._held }
  pause() { this._post({ t: 'pause' }) }
  resume() { this._post({ t: 'resume' }) }
  step() { this._post({ t: 'step' }) }
  stepLine() { this._post({ t: 'stepLine' }) }
  setSpeed(value) {
    this.speed = value
    this._pace = null
    this._post({ t: 'speed', value })
  }
  press(n, down) { this._post({ t: 'input', what: 'button', n, down }) }
  tilt(x, y) { this._post({ t: 'input', what: 'tilt', x, y }) }
  setLight(lux) { this._post({ t: 'input', what: 'light', lux }) }
  reset() { this._post({ t: 'reset' }) }
  // Lay a line course (an id from world/courses.js, or null for none); the
  // robot starts again on it.
  setCourse(id) {
    this.course = id || null
    this._post({ t: 'course', course: this.course })
  }
  // Move a 3D board to another room (an id from kinds.js ROOMS); it starts
  // again at the room's start, on the course if one is laid.
  setRoom(id) {
    if (!ROOMS[id]) return
    this.room = id
    if (!this.worker || KINDS[this.targetId]?.view !== '3d') return
    this._post({ t: 'room', env: id })
    this._moved = true              // the camera goes with it, at the next frame
    this.view?.loadRoom(id).catch((err) => console.warn('room', err))
    this._roomMusic(id)
  }
  // A room's music track (kinds.js MUSIC), or none.
  _roomMusic(id) {
    const m = MUSIC[id]
    this.setMusic(m ? new URL(m.file, new URL('sim-assets/', document.baseURI)).href : null, m ? t(m.credit) : null)
  }
  // Play a music track (a URL; null for none) on the music bus, looped, with
  // its credit. The settings panel shows the Music slider and the credit
  // while there is one ('music' event).
  setMusic(url, credit = null) {
    if ((this.music ?? null) === (url ?? null)) return
    this.music = url ?? null
    this.musicCredit = url ? credit : null
    this.speaker?.music(this.music)
    this.dispatchEvent(new CustomEvent('music', { detail: { url: this.music, credit: this.musicCredit } }))
  }
  // The room a 3D board is in, as a sentence names it; null for CodeX.
  _roomName() {
    const kind = KINDS[this.targetId]
    return kind?.view === '3d' ? ROOMS[this.room ?? kind.env]?.toLocaleLowerCase(language) : null
  }

  setCamera(mode) {
    this.cameraMode = mode
    this.view?.setCamera(mode)
  }

  // The terminal: Ctrl-C stops a program; between programs, a live REPL.
  sendRaw(data) {
    const text = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data)
    this._post({ t: 'stdin', text })
  }

  _post(m) {
    this.worker?.postMessage(m)
  }

  _onMessage(m) {
    switch (m.t) {
      case 'ready': this._course = m.course; this._ready?.(m.snapshot); break
      case 'course': this.view?.setCourse?.(m.course); break
      case 'frame': {
        this.view?.push(m.snapshot)
        if (this._moved) { this._moved = false; this.view?.setCamera?.(this.cameraMode) }
        this.describer?.frame(m.snapshot, this._roomName())
        this.lastFrame = m.snapshot
        this.speaker?.frame(m.snapshot.devices[0])
        this._measurePace(m.snapshot.t)
        break
      }
      case 'screen': this.view?.screen?.(m.px); break
      case 'saved': this._saved?.get(m.name)?.(); this._saved?.delete(m.name); break
      case 'output': this.dispatchEvent(new CustomEvent('data', { detail: m.bytes })); break
      case 'state':
        // paused, simulated time stands still, and so does the sound
        this.speaker?.hold(m.state === 'paused')
        this._pace = null
        this.slow = false
        this._held = m.state === 'paused'
        if (m.state === 'paused') this._setState(State.RUNNING, m.line ? t('sim.pausedAt', { line: m.line }) : t('sim.paused'))
        else if (m.state === 'running') this._setState(State.RUNNING, t('sim.running'))
        this._line(m.state === 'paused' ? m.line : null)
        break
      case 'done': {
        const r = m.result
        this.speaker?.hold(false)
        this._held = false
        this.slow = false
        this._line(null)
        this._stopped?.()
        this._stopped = null
        if (r.error) {
          this.dispatchEvent(new CustomEvent('program-error', { detail: r.error }))
          this._setState(State.READY, t('sim.stoppedWithError'))
        } else if (r.stopped) {
          this._emitText(`\r\n\x1b[90m${t('sim.stopped')}\x1b[0m\r\n`)
          this._setState(State.READY, t('sim.stoppedReady'))
        } else {
          this._emitText(`\r\n\x1b[90m${t('sim.finished')}\x1b[0m\r\n`)
          this._setState(State.READY, t('sim.finished'))
        }
        break
      }
      case 'error':
        console.error(m.message)
        this._notice('error', t('sim.problemTitle'), m.message.split('\n')[0])
        break
    }
  }

  // The pace: simulated seconds a wall second, over each second of frames.
  // A machine that cannot keep up never shortens the world's steps: the
  // simulation runs slower than real time instead, and the status says so.
  _measurePace(simUs) {
    const now = performance.now()
    const p = (this._pace ??= { wall: now, sim: simUs })
    if (now - p.wall < 1000) return
    this.pace = (simUs - p.sim) / 1000 / (now - p.wall)
    this._pace = { wall: now, sim: simUs }
    if (this.state !== State.RUNNING || this._held) return
    const slow = this.pace < 0.85 * (this.speed ?? 1)
    if (slow === !!this.slow) return
    this.slow = slow
    this._setState(State.RUNNING, slow ? t('sim.runningSlow', { percent: Math.round((100 * this.pace) / (this.speed ?? 1)) }) : t('sim.running'))
  }

  _line(line) {
    this.dispatchEvent(new CustomEvent('line', { detail: { line } }))
  }

  _emitText(s) {
    this.dispatchEvent(new CustomEvent('data', { detail: enc.encode(s) }))
  }

  _setState(state, message) {
    this.state = state
    this.dispatchEvent(new CustomEvent('state', { detail: { state, message } }))
  }

  _notice(kind, title, detail) {
    this.dispatchEvent(new CustomEvent('notice', { detail: { kind, title, detail } }))
  }
}

registerDeviceKind('sim', () => new SimDevice(), { label: t('kind.sim') })
