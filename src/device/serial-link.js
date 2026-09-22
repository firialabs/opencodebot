/**
 * Thin Web Serial wrapper: open a paired Firia Labs board, stream bytes in
 * and out, and notice when it is unplugged.
 *
 * Adapted from the WebSerialControl used by Firia Labs CodeSpace, trimmed to
 * what OpenCodeBot needs and generalised to accept any of our boards.
 */
import { ALL_USB_FILTERS, targetIdForPort } from './targets.js'

const BAUD_RATE = 115200

export class SerialLink {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && 'serial' in navigator
    this.port = null
    this.reader = null
    this.writer = null

    /** @type {(bytes: Uint8Array) => void} */
    this.onData = null
    /** @type {(targetId: string|null, port: SerialPort) => void} */
    this.onConnect = null
    /** @type {() => void} */
    this.onDisconnect = null

    this._opening = false
    this._closed = Promise.resolve()
    this._resolveClosed = () => {}
    this._writeChain = Promise.resolve()

    if (this.supported) {
      // A board that is re-plugged (or reset) while we are running should
      // come back on its own without another click.
      navigator.serial.addEventListener('connect', (event) => {
        if (this.port || !this._autoReconnect) return
        if (targetIdForPort(event.target)) this.openPaired()
      })
    }
    this._autoReconnect = false
  }

  get isOpen() {
    return !!this.port?.readable
  }

  /** Show the browser's port picker. Must be called from a user gesture. */
  async requestPort() {
    if (!this.supported) throw new Error('web-serial-unsupported')
    const port = await navigator.serial.requestPort({ filters: ALL_USB_FILTERS })
    if (this.port) return true // an auto-reconnect beat the picker; keep it
    this.port = port
    this._autoReconnect = true
    return this._open()
  }

  /** Open the first already-paired board we recognise, if one is plugged in. */
  async openPaired() {
    if (!this.supported || this.port) return false
    const ports = await navigator.serial.getPorts()
    const match = ports.find((p) => targetIdForPort(p))
    if (!match) return false
    this.port = match
    this._autoReconnect = true
    return this._open()
  }

  async _open() {
    if (this._opening) return false
    this._opening = true
    try {
      if (!this.port.readable) {
        try {
          await this.port.open({ baudRate: BAUD_RATE })
        } catch (err) {
          this.port = null
          throw err
        }
      }
      this._startReading()
      this.onConnect?.(targetIdForPort(this.port), this.port)
      return true
    } finally {
      this._opening = false
    }
  }

  async _startReading() {
    if (!this.port?.readable) return
    this.reader = this.port.readable.getReader()
    this._closed = new Promise((resolve) => {
      this._resolveClosed = resolve
    })

    try {
      for (;;) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value?.length) this.onData?.(value)
      }
    } catch {
      // Expected on unplug — fall through to teardown.
    } finally {
      try {
        this.reader?.releaseLock()
      } catch { /* device already gone */ }
      try {
        this.writer?.releaseLock()
      } catch { /* device already gone */ }
      this.reader = null
      this.writer = null
    }

    try {
      await this.port?.close()
    } catch { /* already closed by the unplug */ }

    this.port = null
    this._resolveClosed()
    this.onDisconnect?.()
  }

  /**
   * Queue bytes for the device. Writes are serialised so a slow write can
   * never interleave with the next one, and a failure never escapes as an
   * unhandled rejection (callers routinely fire-and-forget).
   */
  send(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this._writeChain = this._writeChain.then(async () => {
      if (!this.port?.writable) return
      try {
        if (!this.writer) this.writer = this.port.writable.getWriter()
        await this.writer.write(bytes)
      } catch (err) {
        console.warn('serial write failed', err)
      }
    })
    return this._writeChain
  }

  /** Close the port and stop auto-reconnecting to it. */
  async disconnect() {
    this._autoReconnect = false
    if (!this.port) return
    try {
      await this.reader?.cancel()
      await Promise.race([this._closed, new Promise((r) => setTimeout(r, 1000))])
    } catch (err) {
      console.warn('serial disconnect', err)
    }
  }

  /** Forget every paired port, so the next Connect shows the picker again. */
  async forgetAll() {
    await this.disconnect()
    if (!this.supported || !navigator.serial.getPorts) return
    const ports = await navigator.serial.getPorts()
    await Promise.all(ports.map((p) => p.forget?.().catch(() => {})))
  }
}
