// A simulated board, behind the same face as DeviceManager (the USB board):
// connect, disconnect, run, stop, sendRaw; isConnected, targetId, target,
// state; the events 'state', 'device', 'data', 'notice', 'progress' and
// 'program-error'. The app treats it as one more device. Its own event 'line'
// gives the program's line while paused ({ line }, null when it runs on).
import { State } from '../device/device-manager.js'
import { getTarget } from '../device/targets.js'
import { KINDS } from './kinds.js'

const enc = new TextEncoder()

export class SimDevice extends EventTarget {
  constructor() {
    super()
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
    this.supported = 'WebAssembly' in globalThis && typeof Worker !== 'undefined'
  }

  get isConnected() {
    return !!this.worker
  }

  get target() {
    return getTarget(this.targetId)
  }

  static canSimulate(targetId) {
    return !!KINDS[targetId]
  }

  // Where the picture goes; set before connect.
  attachView(host) {
    this.viewHost = host
  }

  async connect(targetId = 'codebot') {
    if (this.worker) return true
    if (!SimDevice.canSimulate(targetId)) {
      this._notice('warn', `${getTarget(targetId)?.name ?? 'That device'} can't be simulated yet`, 'The simulator has CodeBot, CodeX and CodeAIR so far.')
      return false
    }
    this._setState(State.CONNECTING, 'Starting the simulator…')
    const assetsBase = new URL('sim-assets/', document.baseURI).href
    this.worker = new Worker(new URL('./runtime/worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => this._onMessage(e.data)
    this.worker.onerror = (e) => {
      console.error(e)
      this._notice('error', 'The simulator stopped', e.message || 'Reload the page to start it again.')
    }
    this.targetId = targetId
    const kind = KINDS[targetId]
    const ready = new Promise((resolve) => (this._ready = resolve))
    this.worker.postMessage({ t: 'init', kind: targetId, env: kind.env, assetsBase, course: this.course })
    this.speaker = new Speaker()

    if (this.viewHost) {
      if (kind.view === 'codex') {
        const { CodeXFace } = await import('./view/codex-face.js')
        this.view = new CodeXFace(this.viewHost, { onButton: (n, down) => this.press(n, down) })
      } else {
        const { SimView } = await import('./view/view.js')
        this.view = new SimView(this.viewHost, { assetsBase })
        this.view.cameraMode = this.cameraMode
        await this.view.loadRoom(kind.env).catch((err) => console.warn('room', err))
      }
    }
    const snap = await ready
    for (const d of snap.devices) await this.view?.addDevice(d)
    this.view?.setCourse?.(this._course)
    this.view?.push(snap)

    this.firmware = { version: 'simulator', date: '' }
    this.dispatchEvent(new CustomEvent('device', { detail: { targetId, target: this.target } }))
    this._emitText(`\x1b[32mSimulated ${this.target?.name}${kind.envName === 'hand' ? '' : ` in the ${kind.envName}`}.\x1b[0m\r\n`)
    this._setState(State.READY, 'Simulator ready. Press Run!')
    return true
  }

  async disconnect() {
    this.worker?.terminate()
    this.worker = null
    this.view?.dispose()
    this.view = null
    this.speaker?.close()
    this.speaker = null
    this.targetId = null
    this.busy = false
    this.dispatchEvent(new CustomEvent('device', { detail: { targetId: null, target: null } }))
    this._setState(State.OFFLINE, 'Simulator closed.')
  }

  async forget() {}

  // stepFirst: pause at the program's first line, to step it by line.
  async run(source, { stepFirst = false } = {}) {
    if (!this.worker) return false
    if (this.state === State.RUNNING) {
      await this.stop()
    }
    this._post({ t: 'run', source, stepFirst })
    this._setState(State.RUNNING, 'Your program is running in the simulator!')
    return true
  }

  async stop() {
    if (!this.worker || this.state !== State.RUNNING) return true
    const done = new Promise((r) => (this._stopped = r))
    this._post({ t: 'stop' })
    await done
    return true
  }

  pause() { this._post({ t: 'pause' }) }
  resume() { this._post({ t: 'resume' }) }
  step() { this._post({ t: 'step' }) }
  stepLine() { this._post({ t: 'stepLine' }) }
  setSpeed(value) { this._post({ t: 'speed', value }) }
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
  setCamera(mode) {
    this.cameraMode = mode
    this.view?.setCamera(mode)
  }

  // The terminal: Ctrl-C stops a program; between programs, a live REPL.
  sendRaw(data) {
    const text = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data)
    this._post({ t: 'stdin', text })
  }

  parkActuators() {}

  _post(m) {
    this.worker?.postMessage(m)
  }

  _onMessage(m) {
    switch (m.t) {
      case 'ready': this._course = m.course; this._ready?.(m.snapshot); break
      case 'course': this.view?.setCourse?.(m.course); break
      case 'frame': {
        this.view?.push(m.snapshot)
        this.lastFrame = m.snapshot
        const d = m.snapshot.devices[0]
        this.speaker?.play(d?.sound ?? (d?.tone ? [{ freq: d.tone, wave: 1, level: 1 }] : []))
        break
      }
      case 'screen': this.view?.screen?.(m.px); break
      case 'output': this.dispatchEvent(new CustomEvent('data', { detail: m.bytes })); break
      case 'state':
        if (m.state === 'paused') this._setState(State.RUNNING, m.line ? `Paused at line ${m.line}.` : 'Paused.')
        else if (m.state === 'running') this._setState(State.RUNNING, 'Your program is running in the simulator!')
        this._line(m.state === 'paused' ? m.line : null)
        break
      case 'done': {
        const r = m.result
        this._line(null)
        this._stopped?.()
        this._stopped = null
        if (r.error) {
          this.dispatchEvent(new CustomEvent('program-error', { detail: r.error }))
          this._setState(State.READY, 'Your program stopped with an error.')
        } else if (r.stopped) {
          this._emitText('\r\n\x1b[90mStopped.\x1b[0m\r\n')
          this._setState(State.READY, 'Stopped. Ready when you are!')
        } else {
          this._emitText('\r\n\x1b[90mProgram finished.\x1b[0m\r\n')
          this._setState(State.READY, 'Program finished.')
        }
        break
      }
      case 'error':
        console.error(m.message)
        this._notice('error', 'The simulator hit a problem', m.message.split('\n')[0])
        break
    }
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

// The board's speaker: the voices the device is sounding, each an
// oscillator at its frequency and level. Created on the click that starts the
// simulator, which browsers require before they make sound.
const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'square', 'sine', 'sawtooth']

class Speaker {
  constructor() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.out = this.ctx.createGain()
    this.out.gain.value = 0.08
    this.out.connect(this.ctx.destination)
    this.voices = []
    this.last = ''
  }

  play(sounds) {
    if (!this.ctx) return
    const key = JSON.stringify(sounds)
    if (key === this.last) return
    this.last = key
    const t = this.ctx.currentTime
    while (this.voices.length < sounds.length) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(this.out)
      osc.start()
      this.voices.push({ osc, gain })
    }
    this.voices.forEach((v, i) => {
      const s = sounds[i]
      if (s) {
        v.osc.type = WAVES[s.wave] ?? 'triangle'
        v.osc.frequency.setValueAtTime(Math.min(s.freq, 20000), t)
      }
      v.gain.gain.setTargetAtTime(s ? Math.min(1, s.level) : 0, t, 0.005)
    })
  }

  close() {
    this.ctx?.close()
  }
}
