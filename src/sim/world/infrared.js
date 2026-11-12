// Infrared on CodeX and CodeAIR: an emitter and a receiver at 38 kHz. The
// device's own infrared.py encodes a message as a burst of pulses (on and off
// times in µs) through pulseio's PulseOut, and decodes what PulseIn buffered.
// Here a burst reaches every other board on the air once it has been sent,
// and the sender's own receiver too, as on the device (where it sees its own
// emitter; infrared.py's flush() is for that). Range and aim are not
// modelled: boards in the same air see each other, as a pair held together
// for pairing do.

export class Infrared {
  medium = 'ir'

  constructor(rng) {
    this.rng = rng
    this.air = null
    this.flying = []        // bursts on their way, landing at atUs
    this.reset(0)
  }

  // A fresh VM: no PulseIn yet. What is still on its way lands later.
  reset(nowUs) {
    this._land(nowUs)
    this.maxlen = 0         // the PulseIn's buffer; 0 while there is none
    this.buffer = []
    this.paused = false
  }

  // A PulseIn on the receiver, holding at most maxlen pulses.
  open(maxlen) {
    this.maxlen = maxlen
    this.buffer = []
    this.paused = false
  }

  // PulseOut.send: the pulses go out over their own duration.
  send(pulses, nowUs) {
    const done = nowUs + pulses.reduce((a, b) => a + b, 0)
    this.hear(pulses, done)
    this.air?.transmit(this, pulses, done)
  }

  hear(pulses, atUs) {
    let i = this.flying.length
    while (i > 0 && this.flying[i - 1].atUs > atUs) i--
    this.flying.splice(i, 0, { pulses, atUs })
  }

  _land(nowUs) {
    while (this.flying.length && this.flying[0].atUs <= nowUs) {
      const { pulses } = this.flying.shift()
      if (!this.maxlen || this.paused) continue
      // A receiver's edges wander a little (well inside infrared.py's rounding).
      for (const p of pulses) this.buffer.push(Math.max(1, Math.round(p * (1 + 0.03 * this.rng.normal()))))
      if (this.buffer.length > this.maxlen) this.buffer.splice(0, this.buffer.length - this.maxlen)
    }
  }

  // PulseIn's face, as of `nowUs`.
  length(nowUs) { this._land(nowUs); return this.buffer.length }
  get(i) { return this.buffer[i < 0 ? this.buffer.length + i : i] ?? 0 }
  popleft() { return this.buffer.shift() ?? 0 }
  clear() { this.buffer = [] }
  pause(on, nowUs) { this._land(nowUs); this.paused = !!on }
}
