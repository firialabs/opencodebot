// The world: a room, the devices in it, and the clock.
//
// Time is simulated, in whole microseconds, and the world steps on a fixed
// tick (1 ms). Nothing here reads the wall clock or Math.random, so the same
// program, seed and inputs give the same run on any machine.
import { Rng } from './rng.js'

export const TICK_US = 1000

export class World {
  constructor(env, { seed = 1 } = {}) {
    this.env = env
    this.rng = new Rng(seed)
    this.devices = []
    this.timeUs = 0           // simulated time
    this.stepped = 0          // ticks stepped
    this.epochMs = Date.UTC(2026, 0, 1)   // what time.time() reports at t = 0
    this.listeners = []
  }

  add(device) {
    this.devices.push(device)
    return device
  }

  // Advance simulated time, stepping every whole tick it crosses.
  advance(us) {
    const target = this.timeUs + us
    while ((this.stepped + 1) * TICK_US <= target) {
      this.stepped++
      this.timeUs = this.stepped * TICK_US
      for (const d of this.devices) d.step(TICK_US / 1e6)
      for (const f of this.listeners) f(this)
    }
    this.timeUs = target
  }

  // Call f after every tick (for traces and tests).
  onTick(f) {
    this.listeners.push(f)
  }

  snapshot() {
    return { t: this.timeUs, devices: this.devices.map((d) => d.snapshot()) }
  }
}
