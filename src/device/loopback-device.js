/**
 * A pretend board that lives entirely in the page. It runs nothing: it keeps
 * the files it is sent and answers like a quiet, well-behaved device.
 *
 * Used by the automated tests (no hardware in the cloud) and as the smallest
 * working example of a DeviceTarget for anyone adding a new kind, such as
 * the simulator. Open the app with `?device=loopback` to use it, and
 * `&board=codex` to choose which board it claims to be (default CodeBot).
 */
import { State, registerDeviceKind } from './device-target.js'
import { t } from '../i18n/index.js'
import { getTarget } from './targets.js'

const encoder = new TextEncoder()

export class LoopbackDevice extends EventTarget {
  constructor({ board } = {}) {
    super()
    this.kind = 'loopback'
    this.supported = true
    this.isConnected = false
    this.state = State.OFFLINE
    this.targetId = null
    this.firmware = null
    this.board = board || boardFromUrl() || 'codebot'
    /** Everything written to the pretend filesystem, by name. */
    this.files = {}
    /** Every program passed to run(), oldest first. */
    this.runs = []
    this._line = ''
  }

  async connect() {
    this._setState(State.CONNECTING, t('usb.looking'))
    this.isConnected = true
    this.targetId = this.board
    this.firmware = { version: 'loopback', date: '2026-01-01' }
    this._emit('device', { targetId: this.targetId, target: getTarget(this.targetId), firmware: this.firmware })
    this._print('>>> ')
    this._setState(State.READY, t('usb.ready'))
    return true
  }

  async disconnect() {
    this.isConnected = false
    this.targetId = null
    this.firmware = null
    this._emit('device', { targetId: null, target: null })
    this._setState(State.OFFLINE, t('usb.unplugged'))
  }

  async run(source) {
    if (!this.isConnected) return false
    this._setState(State.LOADING, t('usb.sending'))
    await this.writeFile('main.py', source)
    this.runs.push(source)
    this._print('\r\n[loopback] running main.py\r\n')
    this._setState(State.RUNNING, t('usb.running'))
    return true
  }

  async stop() {
    if (!this.isConnected) return false
    this._print('\r\n>>> ')
    this._setState(State.READY, t('usb.stoppedReady'))
    return true
  }

  async writeFile(name, contents) {
    if (!this.isConnected) return false
    this.files[name] = contents
    this._emit('progress', 1)
    return true
  }

  /** Echo typing, like a REPL with nothing behind it. */
  sendRaw(data) {
    if (!this.isConnected) return
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    for (const ch of text) {
      if (ch === '\r') {
        this._print(`\r\n${this._line ? `[loopback] ${this._line}\r\n` : ''}>>> `)
        this._line = ''
      } else if (ch === '\x03') {
        this.stop()
      } else {
        this._line += ch
        this._print(ch)
      }
    }
  }

  _print(text) {
    this._emit('data', encoder.encode(text))
  }

  _setState(state, message) {
    this.state = state
    this._emit('state', { state, message })
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

function boardFromUrl() {
  try {
    return new URL(globalThis.location.href).searchParams.get('board')
  } catch {
    return null
  }
}

registerDeviceKind('loopback', () => new LoopbackDevice(), { label: t('kind.loopback') })
