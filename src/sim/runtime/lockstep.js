// Several engines on one timeline, in Node: each world has its own clock,
// and none runs more than a slice ahead of the slowest, so devices that talk
// to each other (the radio) see each other's messages at the right moment.
//
// The engines take turns in one event loop and yield at wall-clock moments,
// so which one runs when is not repeatable; what makes a run repeatable is
// that a message sent before the barrier at `horizonUs` is heard no earlier
// than the next barrier, which every engine reaches only after it is sent.
// (That holds while no single device call charges more than a slice.)
import { LATENCY_US } from '../world/radio.js'

export const SLICE_US = 10000

export class Lockstep {
  constructor(sliceUs = SLICE_US) {
    this.sliceUs = sliceUs
    this.horizonUs = sliceUs
    this.members = []
    this._waiters = []
  }

  // A world on this timeline; `done` once its program has ended.
  join(world) {
    const m = { world, done: false }
    this.members.push(m)
    return m
  }

  leave(m) {
    m.done = true
    this._advance()
  }

  // Called at each suspension: wait here while this world is at or past the
  // horizon and another is still short of it.
  async wait(m) {
    while (!m.done && m.world.timeUs >= this.horizonUs) {
      if (this._advance()) continue
      await new Promise((r) => this._waiters.push(r))
    }
  }

  _advance() {
    const live = this.members.filter((x) => !x.done)
    if (live.some((x) => x.world.timeUs < this.horizonUs)) return false
    if (!live.length) return false
    const least = Math.min(...live.map((x) => x.world.timeUs))
    this.horizonUs = (Math.floor(least / this.sliceUs) + 1) * this.sliceUs
    // Each in a task of its own: an engine resumed must run its VM up to
    // its next suspension before another resumes, as they share the realm's
    // globals (Engine's lockstep option).
    const w = this._waiters
    this._waiters = []
    for (const r of w) setImmediate(r)
    return true
  }
}

// The air of a lockstep group: what one board sends (a radio message, an
// infrared burst) reaches every other board's part of the same medium after
// the radio's latency, and no sooner than the barrier after the one the
// sender is working toward.
export class LockstepAir {
  constructor(lockstep) {
    this.lockstep = lockstep
    this.parts = []
  }

  // A board's radio or infrared (anything with `medium` and `hear`).
  add(part) {
    this.parts.push(part)
    part.air = this
  }

  transmit(from, payload, nowUs) {
    const at = Math.max(nowUs + LATENCY_US, this.lockstep.horizonUs + this.lockstep.sliceUs)
    for (const p of this.parts) if (p !== from && p.medium === from.medium) p.hear(payload, at)
  }
}
