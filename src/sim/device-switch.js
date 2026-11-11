// One device for the app, which is either the board on the USB cable or the
// simulator. It has DeviceManager's face and passes on the events of
// whichever is in use, so the rest of the app does not care which it is.
const EVENTS = ['state', 'device', 'data', 'notice', 'progress', 'program-error']

export class DeviceSwitch extends EventTarget {
  constructor(usb, sim) {
    super()
    this.usb = usb
    this.sim = sim
    this.active = usb
    for (const backend of [usb, sim]) {
      for (const type of EVENTS) {
        backend.addEventListener(type, (e) => {
          // A board plugged in while simulating takes over: it is what the
          // student is holding.
          if (backend === usb && backend !== this.active && type === 'device' && e.detail?.targetId) {
            this.sim.disconnect()
            this.active = usb
          }
          if (backend === this.active) this.dispatchEvent(new CustomEvent(type, { detail: e.detail }))
        })
      }
    }
  }

  get simulating() { return this.active === this.sim && this.sim.isConnected }
  get link() { return this.usb.link }
  get supported() { return this.usb.supported }
  get isConnected() { return this.active.isConnected }
  get targetId() { return this.active.targetId }
  get target() { return this.active.target }
  get state() { return this.active.state }
  get firmware() { return this.active.firmware }
  get busy() { return this.active.busy }

  async connect() {
    if (this.simulating) await this.sim.disconnect()
    this.active = this.usb
    return this.usb.connect()
  }

  async simulate(targetId) {
    if (this.usb.isConnected) await this.usb.disconnect()
    this.active = this.sim
    return this.sim.connect(targetId)
  }

  disconnect() { return this.active.disconnect() }
  forget() { return this.active.forget() }
  run(source) { return this.active.run(source) }
  stop(opts) { return this.active.stop(opts) }
  sendRaw(data) { return this.active.sendRaw(data) }
  parkActuators() { return this.active.parkActuators() }
}
