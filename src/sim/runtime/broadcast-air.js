// The air between boards in a browser. Each simulated board runs in its own
// worker, and a BroadcastChannel reaches every other worker of this app: the
// boards on one page, and those in other tabs and windows of the same
// browser, as a class's devices on one desk hear each other. A message lands
// on the receiving board's own clock, the radio's latency after it arrives.
import { LATENCY_US } from '../world/radio.js'

const CHANNEL = 'opencodebot-sim-radio'

export class BroadcastAir {
  // clock: () => the receiving world's time, in µs
  constructor(clock) {
    this.clock = clock
    this.radio = null
    this.bc = new BroadcastChannel(CHANNEL)
    this.bc.onmessage = (e) => {
      const { channel, message } = e.data
      this.radio?.hear(channel, message, this.clock() + LATENCY_US)
    }
  }

  // This worker's radio (one board per worker).
  add(radio) {
    this.radio = radio
    radio.air = this
  }

  transmit(from, channel, message) {
    this.bc.postMessage({ channel, message })
  }
}
