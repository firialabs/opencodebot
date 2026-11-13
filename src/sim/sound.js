// What the simulator sounds like, on the main thread: Web Audio, fed from the
// snapshots the world sends. Four buses, each with its own gain from the
// settings panel (settings.js), into one output:
//
//   motors   CodeAIR's rotor whine, CodeBot's gearmotor hum (`whine` voices)
//   speaker  the board's speaker and audio (`sound`, or `tone`)
//   effects  knocks: a CodeAIR's frame clattering on the floor, a body
//            thumping into a wall or a box (`hits`, world/hits.js)
//   music    a room's music track, looped, where the room has one
//
// Every sound here is synthesized (oscillators and filtered noise); the only
// recorded audio is a room's music. Created on the click that starts the
// simulator, which browsers require before they make sound. Headless runs
// never make one: they are silent.
import { settings, BUSES } from './settings.js'

const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'square', 'sine', 'sawtooth']

// Each bus's gain at its default slider setting is the level the simulator
// had before it had sliders; 100 is a little louder.
const TRIM = { motors: 1.8 / 0.49, speaker: 1 / 0.64, effects: 1 / 0.49, music: 0.5 / 0.25 }
const OUT = 0.08

export class Speaker {
  constructor() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return
    const ctx = (this.ctx = new AC())
    this.out = ctx.createGain()
    this.out.gain.value = OUT
    this.out.connect(ctx.destination)
    this.bus = {}
    for (const b of BUSES) {
      this.bus[b] = ctx.createGain()
      this.bus[b].connect(this.out)
    }
    this._levels()
    this._onChange = () => this._levels()
    settings.addEventListener('change', this._onChange)

    this.voices = []
    this.last = ''
    // The motors: a sawtooth each through one low-pass.
    this.motorFilter = ctx.createBiquadFilter()
    this.motorFilter.type = 'lowpass'
    this.motorFilter.frequency.value = 3500
    this.motorFilter.connect(this.bus.motors)
    this.rotors = []
    this.lastHit = 0
    this.track = null              // the music track playing: { url, source }
  }

  // Each bus's gain now, as the settings set it; null without Web Audio.
  levels() {
    if (!this.ctx) return null
    return Object.fromEntries(BUSES.map((b) => [b, this.bus[b].gain.value / TRIM[b]]))
  }

  _levels() {
    for (const b of BUSES) this.bus[b].gain.value = settings.gain(b) * TRIM[b]
  }

  // What a frame brings: the speaker's voices, the motors', and new knocks.
  frame(d) {
    if (!this.ctx || !d) return
    this.play(d.sound ?? (d.tone ? [{ freq: d.tone, wave: 1, level: 1 }] : []))
    this.whine(d.whine ?? [])
    this.knocks(d.hits ?? [])
  }

  // The motors: { freq, level } for each one turning, as the frames bring
  // them; pitch and level glide between frames.
  whine(voices) {
    if (!this.ctx || (!voices.length && !this.rotors.length)) return
    const t = this.ctx.currentTime
    while (this.rotors.length < voices.length) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(this.motorFilter)
      osc.start()
      this.rotors.push({ osc, gain, on: false })
    }
    this.rotors.forEach((v, i) => {
      const s = voices[i]
      if (s) v.osc.frequency.setTargetAtTime(s.freq, t, 0.02)
      if (s || v.on) v.gain.gain.setTargetAtTime(s ? s.level / 4 : 0, t, 0.02)
      v.on = !!s
    })
  }

  // The speaker: a voice for each sound the board is making.
  play(sounds) {
    if (!this.ctx) return
    const key = JSON.stringify(sounds)
    if (key === this.last) return
    this.last = key
    const t = this.ctx.currentTime
    while (this.voices.length < sounds.length) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(this.bus.speaker)
      osc.start()
      this.voices.push({ osc, gain })
    }
    this.voices.forEach((v, i) => {
      const s = sounds[i]
      if (s) {
        v.osc.type = WAVES[s.wave] ?? 'triangle'
        v.osc.frequency.setValueAtTime(Math.min(s.freq, 20000), t)
      }
      v.gain.gain.setTargetAtTime(s ? Math.min(1, s.level) : 0, t, 0.005)
    })
  }

  // Knocks the frame has that have not been heard yet (a reset numbers them
  // from 1 again). A pile-up in one frame plays its two hardest.
  knocks(hits) {
    if (!hits.length) return
    const newest = hits[hits.length - 1].n
    if (newest < this.lastHit) this.lastHit = 0
    const fresh = hits.filter((h) => h.n > this.lastHit)
    this.lastHit = newest
    fresh.sort((a, b) => b.speed - a.speed).slice(0, 2).forEach((h, i) => {
      if (h.kind === 'clatter') this.clatter(h.speed, i * 0.012)
      else this.thump(h.speed, i * 0.012)
    })
  }

  // Plastic on the floor: a hollow knock, then a few bright ticks as the
  // frame bounces and rattles to rest, more and louder the harder it hit.
  // speed: m/s into the floor (a knock starts at 0.3; a landing touches at
  // about 1, a light tap; a fall from a metre hits at 4.4, the loudest).
  clatter(speed, delay = 0) {
    if (!this.ctx) return
    const L = clamp((speed - 0.8) / 3, 0.05, 1)
    let t = this.ctx.currentTime + delay
    this._burst(t, { type: 'bandpass', freq: 900, q: 2, amp: 0.7 * L, decay: 0.06 })
    let amp = L, gap = 0.05 + 0.06 * L
    const ticks = 2 + Math.round(4 * L)
    for (let i = 0; i < ticks; i++) {
      this._burst(t, { type: 'bandpass', freq: 2200 + Math.random() * 2800, q: 1.4, amp, decay: 0.02 + 0.03 * Math.random() })
      t += gap * (0.7 + 0.6 * Math.random())
      gap *= 0.65
      amp *= 0.55
    }
  }

  // A body into a wall or a box: a dull, low knock. speed: m/s into it.
  thump(speed, delay = 0) {
    if (!this.ctx) return
    const L = clamp(speed / 1.2, 0.06, 1)
    const t = this.ctx.currentTime + delay
    this._burst(t, { type: 'lowpass', freq: 450, q: 0.7, amp: 1.2 * L, decay: 0.08 })
    const osc = this.ctx.createOscillator()
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(L, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
    osc.connect(g).connect(this.bus.effects)
    osc.start(t)
    osc.stop(t + 0.16)
  }

  // A burst of filtered noise: a 2 ms rise, then an exponential fall.
  _burst(t, { type, freq, q, amp, decay }) {
    const ctx = this.ctx
    this.noise ??= noiseBuffer(ctx)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(amp, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.002 + decay * 4)
    src.connect(f).connect(g).connect(this.bus.effects)
    src.start(t, Math.random() * 0.5)
    src.stop(t + 0.01 + decay * 4)
  }

  // A room's music: the track at `url` (null for none), looped on the music
  // bus. It is heard in simulated time: a pause holds it with everything else.
  async music(url) {
    if (!this.ctx || this.track?.url === url) return
    this.track?.source?.stop()
    this.track = url ? { url, source: null } : null
    if (!url) return
    try {
      const data = await (await fetch(url)).arrayBuffer()
      const buffer = await this.ctx.decodeAudioData(data)
      if (this.track?.url !== url) return       // another room meanwhile
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(this.bus.music)
      source.start()
      this.track.source = source
    } catch (err) {
      console.warn('music', err)
    }
  }

  // Paused: the sound stops where it is, and goes on when the program does.
  hold(on) {
    if (!this.ctx) return
    if (on) this.ctx.suspend()
    else if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  close() {
    settings.removeEventListener('change', this._onChange)
    this.ctx?.close()
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = buffer.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buffer
}
