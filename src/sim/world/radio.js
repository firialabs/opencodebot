// The 2.4 GHz radio of CodeX and CodeAIR, and the air between boards.
//
// On the device the radio is a C module over ESP-NOW broadcast: a message
// goes to every radio on the same channel, the sender does not hear itself,
// and each receiver queues what it hears until the program asks for it. Here
// a Radio is that queue and its settings; an Air carries messages between
// radios, and infrared between boards (world/infrared.js), each medium to its
// own kind. Which Air depends on where the devices are:
// - in the browser each board runs in its own worker, and BroadcastAir
//   (runtime/broadcast-air.js) carries messages between workers, so boards in
//   one page, or in two tabs of the same browser, hear each other;
// - in Node, runHeadlessGroup puts several devices on one LockstepAir, on one
//   timeline (runtime/lockstep.js), so a run is the same every time.

export const LATENCY_US = 2000     // send to queued; ESP-NOW takes a few ms (to measure)
export const QUEUE_DEPTH = 32      // what the device's queue holds (to check on a device)

export class Radio {
  medium = 'radio'          // what the air carries it on (with 'ir')

  constructor(rng) {
    this.rng = rng
    this.air = null         // set by whoever connects this device to others
    this.flying = []        // on the air, landing at atUs
    this.reset(0)
  }

  // A fresh VM: the radio module starts off, on channel 0, with nothing
  // heard. What is still on the air lands later, under the new settings.
  reset(nowUs) {
    this._land(nowUs)
    this.on = false
    this.channel = 0
    this.queue = []         // heard, waiting for the program
  }

  set(on, channel, nowUs) {
    this._land(nowUs)       // what landed before the change, under the old settings
    if (!on) this.queue = []
    this.on = !!on
    this.channel = channel
  }

  send(message, nowUs) {
    if (!this.on) return
    this.air?.transmit(this, { channel: this.channel, message: String(message) }, nowUs)
  }

  // A message on the air reaches this radio at `atUs` on its own clock;
  // whether it is heard depends on the radio's settings then.
  hear({ channel, message }, atUs) {
    let i = this.flying.length
    while (i > 0 && this.flying[i - 1].atUs > atUs) i--
    this.flying.splice(i, 0, { channel, message, atUs })
  }

  _land(nowUs) {
    while (this.flying.length && this.flying[0].atUs <= nowUs) {
      const m = this.flying.shift()
      if (!this.on || m.channel !== this.channel || this.queue.length >= QUEUE_DEPTH) continue
      // Signal strength: boards on one desk, a little noise.
      m.rssi = Math.round(-42 + 3 * this.rng.normal())
      this.queue.push(m)
    }
  }

  // The next message heard by now: [message, rssi, ms tick], or null.
  receive(nowUs) {
    this._land(nowUs)
    if (!this.on || !this.queue.length) return null
    const m = this.queue.shift()
    return [m.message, m.rssi, Math.floor(m.atUs / 1000)]
  }
}
