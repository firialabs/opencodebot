// One device for the app: a DeviceTarget (docs/device-targets.md) that is
// either the board (whatever kind the page was opened with: the USB board, or
// the loopback in tests) or the simulator, and passes on the events of
// whichever is in use, so the rest of the app does not care which it is.
import { EVENTS } from '../device/device-target.js'

export class DeviceSwitch extends EventTarget {
  constructor(board, sim) {
    super()
    this.board = board
    this.sim = sim
    this.active = board
    for (const backend of [board, sim]) {
      for (const type of EVENTS) {
        backend.addEventListener(type, (e) => {
          // A board plugged in while simulating takes over: it is what the
          // student is holding.
          if (backend === board && backend !== this.active && type === 'device' && e.detail?.targetId) {
            this.sim.disconnect()
            this.active = board
          }
          if (backend === this.active) this.dispatchEvent(new CustomEvent(type, { detail: e.detail }))
        })
      }
    }
  }

  get simulating() { return this.active === this.sim && this.sim.isConnected }
  get kind() { return this.active.kind }
  get supported() { return this.board.supported }
  get isConnected() { return this.active.isConnected }
  get targetId() { return this.active.targetId }
  get target() { return this.active.target }
  get state() { return this.active.state }
  get firmware() { return this.active.firmware }

  async connect() {
    if (this.simulating) await this.sim.disconnect()
    this.active = this.board
    return this.board.connect()
  }

  async autoConnect() {
    return this.board.autoConnect?.() ?? false
  }

  async simulate(targetId) {
    if (this.board.isConnected) await this.board.disconnect()
    this.active = this.sim
    return this.sim.connect(targetId)
  }

  disconnect() { return this.active.disconnect() }
  run(source, opts) { return this.active.run(source, opts) }
  stop(opts) { return this.active.stop(opts) }
  sendRaw(data) { return this.active.sendRaw(data) }
  writeFile(name, contents) { return this.active.writeFile(name, contents) }
}
