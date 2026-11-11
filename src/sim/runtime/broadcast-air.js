// The air between boards in a browser, for radio and infrared. Each simulated
// board runs in its own worker, and a BroadcastChannel reaches every other
// worker of this app: the boards on one page, and those in other tabs and
// windows of the same browser, as a class's devices on one desk hear each
// other. A message lands on the receiving board's own clock, the radio's
// latency after it arrives.
import { LATENCY_US } from '../world/radio.js'

const CHANNEL = 'opencodebot-sim-radio'

export class BroadcastAir {
  // clock: () => the receiving world's time, in µs
  constructor(clock) {
    this.clock = clock
    this.parts = {}           // this worker's board: its radio, its infrared
    this.bc = new BroadcastChannel(CHANNEL)
    this.bc.onmessage = (e) => {
      const { medium, payload } = e.data
      this.parts[medium]?.hear(payload, this.clock() + LATENCY_US)
    }
  }

  // A part of this worker's board (one board per worker) with `medium` and `hear`.
  add(part) {
    this.parts[part.medium] = part
    part.air = this
  }

  transmit(from, payload) {
    this.bc.postMessage({ medium: from.medium, payload })
  }
}
