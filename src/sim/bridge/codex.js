// CodeX's board, simulated at the level its own codex.py drives it, plus the
// faces of its C modules (graphics, tone generator, button ISR). The `_sim`
// module the Python layer calls.
//
// From codex.py and its drivers: a TCA9535 IO expander at 0x24 (LEDs on
// outputs 2-7; input 0 low when on USB), the buttons latched by an ISR, a
// KXTJ3 at 0x0E, an LTR-303 light sensor at 0x29, the backlight PWM on IO6,
// battery voltage and current on IO2 and IO1.
import { KXTJ3, fromHex } from './chips.js'

const PINS = [
  'IO0', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13',
  'IO14', 'IO15', 'IO16', 'IO17', 'IO18', 'IO19', 'IO20', 'IO21', 'IO26', 'IO33', 'IO34', 'IO35', 'IO36',
  'IO37', 'IO38', 'IO39', 'IO40', 'IO41', 'IO42', 'IO43', 'IO44', 'IO45', 'IO46', 'TX', 'RX', 'SCL', 'SDA',
]
const TCA_ADDR = 0x24, KXTJ3_ADDR = 0x0e, ALS_ADDR = 0x29
const VOLTAGE_RATIO = (59 + 107) / 59
const ALS_GAIN = { 0: 1, 1: 2, 2: 4, 3: 8, 6: 48, 7: 96 }

// Device time (estimates until measured; DESIGN.md).
const COST_US = { gpio: 2, adc: 40, pwm: 15, i2cByte: 25, i2cStart: 60, gfxCall: 25, gfxPixel: 0.08 }

export function codexBridge(cx) {
  const tca = { ptr: 0, regs: [0, 0, 0, 0, 0, 0, 0xff, 0xff] }
  // What the KXTJ3 measures; codex.py's driver negates y and z on reading.
  const kx = new KXTJ3(() => { const [x, y, z] = cx.gravity(); return [x, -y, -z] })
  const als = { ptr: 0, contr: 0, regs: new Uint8Array(256) }
  als.regs[0x87] = 0x05; als.regs[0x86] = 0xa0

  const i2cWrite = (addr, b) => {
    if (addr === TCA_ADDR) { tca.ptr = b[0] & 7; if (b.length > 1) tca.regs[tca.ptr] = b[1]; return true }
    if (addr === KXTJ3_ADDR) return kx.write(b)
    if (addr === ALS_ADDR) {
      als.ptr = b[0]
      if (b.length > 1) { als.regs[als.ptr] = b[1]; if (als.ptr === 0x80) als.contr = b[1] }
      return true
    }
    return false
  }

  const i2cRead = (addr, n) => {
    if (addr === TCA_ADDR) {
      if (tca.ptr === 1) return [cx.usb ? 0xfe : 0xff]
      return [tca.regs[tca.ptr]]
    }
    if (addr === KXTJ3_ADDR) return kx.read(n)
    if (addr === ALS_ADDR) {
      if (als.ptr === 0x8c) return [0x84]                // data valid, new data
      if (als.ptr === 0x88) {
        const gain = ALS_GAIN[(als.contr >> 2) & 7] ?? 1
        const ch0 = Math.min(65535, Math.round(cx.lux * gain * (1 + 0.01 * cx.rng.normal())))
        const ch1 = Math.round(ch0 * 0.15)               // the IR share of indoor light
        return [ch1 & 0xff, ch1 >> 8, ch0 & 0xff, ch0 >> 8].slice(0, n)
      }
      return [als.regs[als.ptr]]
    }
    return null
  }

  return (engine) => {
    const c = (us) => engine.charge(us)
    // a fresh VM: the radio and infrared start over
    cx.radio.reset(engine.world.timeUs)
    cx.infrared.reset(engine.world.timeUs)
    const g = cx.gfx
    const draw = (n) => c(COST_US.gfxCall + n * COST_US.gfxPixel)
    return {
      pins: () => PINS,
      temp_c: () => 30.0,
      runtime_us: () => engine.world.timeUs,

      dio_cfg() { c(COST_US.gpio) },
      dio_set() { c(COST_US.gpio) },
      dio_get(pin) { c(COST_US.gpio); return pin === 'IO0' ? (cx.buttons[0] ? 0 : 1) : 1 },
      adc(pin) {
        c(COST_US.adc)
        if (pin === 'IO2') return Math.round((cx.volts / VOLTAGE_RATIO / 3.3) * 65535)
        if (pin === 'IO1') return Math.round((0.9 / 3.3) * 65535)
        return 0
      },
      dac() {},
      pwm(pin, duty) { c(COST_US.pwm); if (pin === 'IO6') cx.brightness = Math.round((duty * 100) / 65535) },
      spi_write() {},
      i2c_scan: () => [KXTJ3_ADDR, TCA_ADDR, ALS_ADDR],
      i2c_write(addr, hex) { const b = fromHex(hex); c(COST_US.i2cStart + COST_US.i2cByte * b.length); return i2cWrite(addr, b) },
      i2c_read(addr, n) { c(COST_US.i2cStart + COST_US.i2cByte * n); return i2cRead(addr, n) },

      // the button ISR's latches, and the expander's outputs
      btn_state(clearFell, clearRose) {
        c(COST_US.gpio)
        const r = [cx.buttonBits(), cx.fell, cx.rose]
        cx.fell &= ~clearFell
        cx.rose &= ~clearRose
        return r
      },
      io_exp_out(v) { c(COST_US.i2cStart + 2 * COST_US.i2cByte); cx.ioOut = v },
      pixels(list) {
        c(40)
        const v = list.split(',').map(Number)
        for (let i = 0; i < 4; i++) cx.pixels[i] = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]
      },

      // graphics
      gfx_new: (w, h, isCanvas, x, y, scale) => { c(COST_US.gfxCall); return g.create(w, h, isCanvas, x, y, scale) },
      gfx_transparent(id, col) { g.get(id).transparent = col; g.touched(0) },
      gfx_pixel(id, x, y, col) { draw(g.touched(g.get(id).bmp.setPixel(x, y, col))) },
      gfx_get_pixel(id, x, y) { c(COST_US.gfxCall); return g.get(id).bmp.getPixel(x, y) },
      gfx_clear(id) { draw(g.clear(id)) },
      gfx_fill(id, col) { draw(g.touched(g.get(id).bmp.fill(col))) },
      gfx_line(id, x0, y0, x1, y1, col) { draw(g.touched(g.get(id).bmp.drawLine(x0, y0, x1, y1, col))) },
      gfx_rect(id, x, y, w, h, col, fill) { const b = g.get(id).bmp; draw(g.touched(fill ? b.fillRect(x, y, w, h, col) : b.drawRect(x, y, w, h, col))) },
      gfx_circle(id, x, y, r, col, fill) { const b = g.get(id).bmp; draw(g.touched(fill ? b.fillCircle(x, y, r, col) : b.drawCircle(x, y, r, col))) },
      gfx_text(id, text, x, y, col, scale, bg) { draw(g.text(id, text, x, y, col, scale, bg)) },
      gfx_image(id, src, x, y, sx, sy, ex, ey, scale) { draw(g.image(id, src, x, y, sx, sy, ex, ey, scale)) },
      gfx_load(id, hex) {
        const b = g.get(id).bmp
        for (let i = 0; i < b.px.length; i++) b.px[i] = parseInt(hex.substr(i * 4, 4), 16)
        draw(g.touched(b.px.length))
      },
      gfx_print(id, text, col, cx_, cy_, scale, bg) { draw(g.print(id, text, col, cx_, cy_, scale, bg)) },
      gfx_show_text(id, text) { draw(g.showText(id, text)) },
      gfx_show_image(id, src) { draw(g.showImage(id, src)) },
      gfx_move(id, x, y) { const it = g.get(id); it.x = x; it.y = y; g.touched(0) },
      gfx_children(id, list) { g.get(id).children = list ? list.split(',').map(Number) : []; g.touched(0) },
      gfx_roots(display, console) { g.roots = [display, console]; g.touched(0) },
      gfx_auto(on) { g.auto = !!on },
      gfx_update() { c(24000); g.updateRequested = true },   // a full refresh over SPI, about 24 ms

      // sound
      voice_new(wave) { cx.voices.push({ freq: 0, wave, gate: false }); return cx.voices.length - 1 },
      voice_freq(id, f) { cx.voices[id].freq = f },
      voice_gate(id, on) { cx.voices[id].gate = !!on },
      voice_wave(id, w) { cx.voices[id].wave = w },
      i2s_play(id) {
        const mixer = id >= 1000 ? id - 1000 : -1
        cx.i2s = { source: mixer >= 0 ? -1 : id, mixer }
      },
      i2s_playing: () => cx.i2s.source !== -1 || cx.i2s.mixer !== -1,
      mixer_new(n) {
        cx.mixers.push(Array.from({ length: n }, () => ({ sample: -1, level: 1 })))
        return 1000 + cx.mixers.length - 1      // mixer ids are 1000 and up
      },
      mixer_voice(m, n, sample, level) { cx.mixers[m - 1000][n] = { sample, level } },
      mixer_level(m, n, level) { cx.mixers[m - 1000][n].level = level },
      audio_volume(v) { cx.volume = v },

      // the radio (world/radio.js): the module's settings, a send, the next message heard
      radio_set(on, channel) { c(COST_US.gpio); cx.radio.set(on, channel, engine.world.timeUs) },
      radio_send(message) { c(2000); cx.radio.send(message, engine.world.timeUs) },
      radio_receive() { c(COST_US.gpio); return cx.radio.receive(engine.world.timeUs) },

      // infrared (world/infrared.js), as pulseio's PulseOut and PulseIn
      ir_send(csv) {
        const pulses = csv ? csv.split(',').map(Number) : []
        cx.infrared.send(pulses, engine.world.timeUs)
        c(pulses.reduce((a, b) => a + b, 0))       // PulseOut.send blocks while it sends
      },
      ir_open(maxlen) { cx.infrared.open(maxlen) },
      ir_len() { c(COST_US.gpio); return cx.infrared.length(engine.world.timeUs) },
      ir_get(i) { return cx.infrared.get(i) },
      ir_popleft() { return cx.infrared.popleft() },
      ir_clear() { cx.infrared.clear() },
      ir_pause(on) { cx.infrared.pause(on, engine.world.timeUs) },
    }
  }
}
