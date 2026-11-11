// CodeX: a handheld with a 240x240 screen, six buttons, six red LEDs, four
// NeoPixels, a speaker, an accelerometer and a light sensor. No physics: the
// student holds it, so tilt and light are inputs.
import { Screen } from './screen.js'
import { Gfx } from './gfx.js'
import { sincos } from './fmath.js'
import { Radio } from './radio.js'

export class CodeX {
  constructor(env, rng, { id = 'codex' } = {}) {
    this.kind = 'codex'
    this.id = id
    this.rng = rng
    this.screen = new Screen(240, 240)
    this.gfx = new Gfx(this.screen)
    this.buttons = [false, false, false, false, false, false]   // U R D L A B
    this.fell = 0
    this.rose = 0
    this.ioOut = 0                 // the IO expander's outputs: LEDs from bit 2
    this.pixels = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
    this.brightness = 0            // backlight, percent
    this.tiltX = 0                 // rad: right edge down
    this.tiltY = 0                 // rad: bottom edge down
    this.lux = 250
    this.volts = 4.1
    this.volume = 0
    this.voices = []               // { freq, wave, gate, glide }
    this.mixers = []               // [ { sample, level } per voice ]
    this.i2s = { source: -1, mixer: -1 }
    this.radio = new Radio(rng)
  }

  step() {}

  // A program ended: sound stops; the screen and backlight stay as they were
  // (codex.py preserves the backlight), as do the LEDs and pixels.
  programEnded() {
    this.i2s = { source: -1, mixer: -1 }
    for (const v of this.voices) v.gate = false
  }

  press(n, down) {
    if (down === this.buttons[n]) return
    this.buttons[n] = down
    if (down) this.fell |= 1 << n
    else this.rose |= 1 << n
  }

  // Bits low while pressed, as the buttons read on the IO expander.
  buttonBits() {
    let v = 0x3f
    this.buttons.forEach((b, i) => { if (b) v &= ~(1 << i) })
    return v
  }

  // The accelerometer's reading as the program sees it: 16384 per g, along
  // gravity, in board coordinates (x right, y down the screen, z out of it).
  // Flat and face up: (0, 0, -16384).
  gravity() {
    const [sx, cx] = sincos(this.tiltX)
    const [sy, cy] = sincos(this.tiltY)
    const n = () => 40 * this.rng.normal()
    return [16384 * sx * cy + n(), 16384 * sy + n(), -16384 * cx * cy + n()]
  }

  // The sounds on the speaker now: { freq, wave, level } for each voice that
  // is connected and sounding.
  sounding() {
    if (this.volume <= 0) return []
    const out = []
    const add = (id, level) => {
      const v = this.voices[id]
      if (v && v.gate && v.freq > 0) out.push({ freq: v.freq, wave: v.wave, level: level * (this.volume / 100) })
    }
    if (this.i2s.source >= 0) add(this.i2s.source, 1)
    if (this.i2s.mixer >= 0) for (const m of this.mixers[this.i2s.mixer] ?? []) if (m.sample >= 0) add(m.sample, m.level)
    return out
  }

  snapshot() {
    return {
      id: this.id, kind: this.kind,
      leds: [0, 1, 2, 3, 4, 5].map((i) => !!((this.ioOut >> (i + 2)) & 1)),
      pixels: this.pixels.map((p) => [...p]),
      brightness: this.brightness,
      buttons: [...this.buttons],
      sound: this.sounding(),
      screenVersion: this.screen.version,
    }
  }
}
