/**
 * The bit that ties everything together: connect to a board, work out which
 * one it is, load a program onto it, and keep the UI honest about what is
 * happening. Everything the UI needs arrives as an event.
 *
 * Events: 'state', 'device', 'data', 'notice', 'progress', 'program-error'
 */
import { SerialLink } from './serial-link.js'
import { ConsoleFilter } from './console-filter.js'
import { Repl, ReplAborted, CTRL_C, CTRL_D } from './repl.js'
import { getTarget, targetIdForPort, TARGETS } from './targets.js'

export const State = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  READY: 'ready',
  LOADING: 'loading',
  RUNNING: 'running',
}

/** Boards whose firmware halts main.py at a debug prompt until told to go. */
const DEBUGGER_TARGETS = new Set(['codex', 'codebot'])

const DEBUG_UNMUTE_MS = 3000
const BOOT_NUDGE_MS = 1000
const BOOT_WAIT_MS = 2200
const PROGRAM_FILENAME = 'main.py'

const decodeLatin1 = (bytes) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096))
  }
  return out
}

export class DeviceManager extends EventTarget {
  constructor() {
    super()
    this.link = new SerialLink()
    this.repl = new Repl(this.link)
    this.filter = new ConsoleFilter((bytes) => this.link.send(bytes))

    this.state = State.OFFLINE
    this.targetId = null // detected board, once connected
    this.firmware = null // { version, date }
    this.busy = false

    this._traceBuf = ''
    this._bootTimers = []
    this._sawPrompt = false

    this.link.onData = (bytes) => this._onBytes(bytes)
    this.link.onConnect = (targetId) => this._onConnected(targetId)
    this.link.onDisconnect = () => this._onDisconnected()
  }

  get supported() {
    return this.link.supported
  }

  get isConnected() {
    return this.link.isOpen
  }

  get target() {
    return getTarget(this.targetId)
  }

  // ------------------------------------------------------------- lifecycle

  /** Show the port picker. Must be called straight from a click. */
  async connect() {
    if (!this.supported) {
      this._notice('error', 'This browser cannot talk to devices', 'Try Chrome or Edge on a computer — they support Web Serial.')
      return false
    }
    this._setState(State.CONNECTING, 'Looking for your device…')
    try {
      const opened = (await this.link.openPaired()) || (await this.link.requestPort())
      if (!opened) this._setState(State.OFFLINE, 'No device chosen.')
      return opened
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        // The picker was dismissed — not an error worth shouting about.
        this._setState(State.OFFLINE, 'No device chosen.')
        return false
      }
      console.error(err)
      this._setState(State.OFFLINE, 'Could not open the device.')
      this._notice('error', 'Could not open that device', friendlyOpenError(err))
      return false
    }
  }

  async disconnect() {
    this._clearBootTimers()
    await this.link.disconnect()
  }

  /** Forget paired ports so the next Connect re-opens the picker. */
  async forget() {
    this._clearBootTimers()
    await this.link.forgetAll()
  }

  _onConnected(targetId) {
    this.targetId = targetId
    this.firmware = null
    this._sawPrompt = false
    this.filter.reset()
    this.repl.resume()

    const target = getTarget(targetId)
    if (target && !target.supported) {
      this._notice('warn', `${target.name} isn't supported yet`, 'OpenCodeBot works with CodeBot CB3, CodeX and CodeAIR.')
    }

    this.dispatchEvent(new CustomEvent('device', { detail: { targetId, target } }))
    this._setState(State.CONNECTING, `Saying hello to your ${target?.name || 'device'}…`)

    // Say nothing at first. Interrupting CircuitPython while its USB stack is
    // still starting up can wedge it past the point where even Ctrl-C helps.
    // Listen for the board to speak, nudge gently, and only then interrupt.
    this._bootTimers.push(
      setTimeout(() => {
        if (!this._sawPrompt && !this.firmware) this.link.send('\r')
      }, BOOT_NUDGE_MS),
      setTimeout(async () => {
        if (this._sawPrompt || this.firmware) return
        // Board is probably already running a program — that's fine, let it.
        this._setState(State.RUNNING, 'Your device is running a program.')
      }, BOOT_WAIT_MS),
    )
  }

  _onDisconnected() {
    this._clearBootTimers()
    this.repl.cancelPending()
    this.targetId = null
    this.firmware = null
    this.busy = false
    this.dispatchEvent(new CustomEvent('device', { detail: { targetId: null, target: null } }))
    this._setState(State.OFFLINE, 'Device unplugged.')
  }

  _clearBootTimers() {
    this._bootTimers.forEach(clearTimeout)
    this._bootTimers = []
  }

  // ------------------------------------------------------------- receiving

  _onBytes(bytes) {
    const text = decodeLatin1(bytes)
    this.repl.feed(text)
    this._sniff(text)

    const visible = this.filter.push(bytes)
    if (visible.length) {
      this.dispatchEvent(new CustomEvent('data', { detail: visible }))
    }
  }

  /** Watch the stream for the things that change what the UI should say. */
  _sniff(text) {
    if (text.includes('>>> ')) {
      this._sawPrompt = true
      this._clearBootTimers()
      if (!this.busy && this.state !== State.READY) {
        this._setState(State.READY, 'Ready when you are!')
      }
    }

    if (!this.firmware) {
      for (const target of Object.values(TARGETS)) {
        const m = target.bootRegex.exec(text)
        if (m) {
          this.firmware = { version: m[1], date: m[2] }
          this._clearBootTimers()
          this.dispatchEvent(
            new CustomEvent('device', {
              detail: { targetId: this.targetId, target: this.target, firmware: this.firmware },
            }),
          )
          break
        }
      }
    }

    if (/Code done running\.|MP-Complete/.test(text) && !this.busy) {
      this._setState(State.READY, 'Program finished.')
    }

    this._checkTraceback(text)
  }

  _checkTraceback(text) {
    this._traceBuf = (this._traceBuf + text).slice(-2000)
    if (!this._traceBuf.includes('Traceback')) return

    const m = /Traceback \(most recent call last\):([\s\S]*?)\r?\n([A-Za-z_]\w*(?:Error|Exception|Interrupt)[^\r\n]*)/.exec(
      this._traceBuf,
    )
    if (!m) return
    this._traceBuf = ''

    const [, frames, errorLine] = m
    if (/KeyboardInterrupt/.test(errorLine)) return // that was the Stop button

    const lineMatch = [...frames.matchAll(/line (\d+)/g)].pop()
    const [name, ...rest] = errorLine.split(':')
    // A crashed CodeBot program leaves the wheels turning; park them.
    if (!this.busy) this.parkActuators()

    this.dispatchEvent(
      new CustomEvent('program-error', {
        detail: {
          name: name.trim(),
          message: rest.join(':').trim(),
          line: lineMatch ? Number(lineMatch[1]) : null,
        },
      }),
    )
  }

  // --------------------------------------------------------------- actions

  /** Raw bytes from the terminal go straight through to the board. */
  sendRaw(data) {
    if (!this.isConnected) return
    if (typeof data === 'string' && data.includes(CTRL_C)) {
      this.repl.cancelPending()
      this.busy = false
    }
    this.link.send(data)
  }

  /** Load `source` onto the board and start it. */
  async run(source) {
    if (!this.isConnected) {
      this._notice('warn', 'No device connected', 'Press Connect and pick your board first.')
      return false
    }
    if (this.busy) return false

    this.busy = true
    this._clearBootTimers()
    this.repl.resume()
    this._setState(State.LOADING, 'Sending your program…')

    try {
      const atPrompt = await this.repl.interrupt()
      if (!atPrompt) throw new DeviceUnresponsive()

      await this.repl.writeFile(PROGRAM_FILENAME, source, (fraction) => {
        this.dispatchEvent(new CustomEvent('progress', { detail: fraction }))
      })

      // Soft reboot: the board auto-runs main.py on the way back up.
      this.link.send(CTRL_D)

      if (DEBUGGER_TARGETS.has(this.targetId)) {
        // These builds halt at a debug prompt on restart; tell them to go.
        try {
          await this.repl.waitFor(/<<< /, 4000)
          // The debugger's own chatter is bracketed, and we have missed the
          // opening marker, so mute until it closes.
          this.filter.suppressDebug(true)
          this.link.send('c\r')
          // Safety net: never leave the terminal muted if the closing marker
          // does not arrive, or the student sees nothing at all.
          setTimeout(() => {
            if (this.filter.suppressed) this.filter.reset()
          }, DEBUG_UNMUTE_MS)
        } catch {
          // No debugger in this firmware — it is already running.
        }
      }

      this.busy = false
      this._setState(State.RUNNING, 'Your program is running!')
      return true
    } catch (err) {
      this.busy = false
      if (err instanceof ReplAborted) {
        this._setState(State.READY, 'Stopped.')
        return false
      }
      console.error(err)
      // Break out of any half-finished triple-quoted string on the device.
      this.link.send(CTRL_C)
      await this.stop({ quiet: true })
      if (err instanceof DeviceUnresponsive) {
        this._notice(
          'error',
          `Your ${this.target?.name || 'device'} isn't answering`,
          'Unplug the USB cable, plug it back in, then press Connect again.',
        )
      } else {
        this._notice('error', "That program didn't load", err.message || 'Please try again.')
      }
      return false
    }
  }

  /**
   * Leave nothing moving. Only CodeBot has anything to park, and this is only
   * ever sent at a REPL prompt, where it is a harmless one-liner.
   */
  parkActuators() {
    if (this.targetId === 'codebot' && this.isConnected) {
      this.link.send('motors.enable(False)\r')
    }
  }

  /** Stop whatever the board is doing and get back to a prompt. */
  async stop({ quiet = false } = {}) {
    if (!this.isConnected) return false
    this.repl.cancelPending()
    this.busy = false
    this.filter.suppressDebug(false)
    this.filter.reset()
    this._setState(State.LOADING, 'Stopping…')

    const stopped = await this.repl.interrupt({ tries: 5, timeout: 900 })
    if (stopped) {
      this.parkActuators()
      this._setState(State.READY, 'Stopped. Ready when you are!')
    } else {
      this._setState(State.READY, 'Device did not answer.')
      if (!quiet) {
        this._notice(
          'warn',
          `Your ${this.target?.name || 'device'} isn't answering`,
          'Unplug the USB cable, plug it back in, then press Connect again.',
        )
      }
    }
    return stopped
  }

  // ---------------------------------------------------------------- events

  _setState(state, message) {
    this.state = state
    this.dispatchEvent(new CustomEvent('state', { detail: { state, message } }))
  }

  _notice(kind, title, detail) {
    this.dispatchEvent(new CustomEvent('notice', { detail: { kind, title, detail } }))
  }
}

class DeviceUnresponsive extends Error {
  constructor() {
    super('Device unresponsive')
    this.name = 'DeviceUnresponsive'
  }
}

function friendlyOpenError(err) {
  const text = String(err?.message || err)
  if (/already open|in use|Failed to open/i.test(text)) {
    return 'Something else may be using the device — close other coding tabs or apps and try again.'
  }
  if (/denied|security/i.test(text)) {
    return 'The browser blocked access. Make sure the page is loaded over https.'
  }
  return text
}

export { targetIdForPort }
