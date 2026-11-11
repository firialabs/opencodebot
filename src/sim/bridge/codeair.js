// CodeAIR's board, simulated at the level its own codeair.py and flight.py
// drive it, plus the faces of its C modules (crtp, codeair_drivers). The
// `_sim` module the Python layer calls.
//
// From codeair.py and the board's pins: eight NeoPixels; an LP5009 LED driver
// on the camera's I2C bus (the eight blue LEDs, reversed, and the status
// LED); BTN_0 and BTN_1, low while pressed, latched by an ISR; the speaker a
// PWM on SPK; the battery through a halving divider on BATT_MON; USB_PGOODN
// low on USB power; D33 the flight controller's reset line. The flight
// controller itself is the simulated Crazyflie, reached through crtp.
import { fromHex } from './chips.js'

const PINS = [
  'CAMERA_DATA', 'CAMERA_DATA2', 'CAMERA_DATA3', 'CAMERA_DATA4', 'CAMERA_DATA5', 'CAMERA_DATA6', 'CAMERA_DATA7',
  'CAMERA_DATA8', 'CAMERA_DATA9', 'CAMERA_HREF', 'CAMERA_PCLK', 'CAMERA_PWDN', 'CAMERA_RESET', 'CAMERA_VSYNC',
  'CAMERA_XCLK', 'CAMERA_SIOD', 'CAMERA_SIOC', 'BUTTON', 'BTN_0', 'BOOT0', 'D0', 'NEOPIXEL_POWER', 'NEOPIXEL', 'D2',
  'CAM_SCL', 'SCL', 'CAM_SDA', 'SDA', 'BATT_MON', 'IR_EMIT', 'D6', 'IR_RCV', 'D7', 'CHG_CURRENT', 'D9', 'D12',
  'QWICC_SCL', 'QWICC_SDA', 'D21', 'D33', 'D39', 'D40', 'D41', 'BTN_1', 'USB_PGOODN', 'SPK', 'D46', 'D47', 'D48',
]
const LP5009 = [0x0c, 0x14]           // its broadcast address, and its own
const OUT0_COLOR = 0x0b

// Device time (estimates until measured; DESIGN.md).
const COST_US = { gpio: 2, adc: 40, pwm: 15, i2cByte: 25, i2cStart: 60, uartByte: 20, crtpCall: 30 }

export function codeairBridge(air) {
  const cf = air.cf
  const lp = { ptr: 0, regs: new Uint8Array(0x18) }
  let consoleOut = false

  const i2cWrite = (addr, b) => {
    if (!LP5009.includes(addr)) return false
    lp.ptr = b[0]
    for (let i = 1; i < b.length; i++) {
      const r = (lp.ptr + i - 1) & 0x1f
      if (r < lp.regs.length) lp.regs[r] = b[i]
      if (r >= OUT0_COLOR && r < OUT0_COLOR + 9) air.leds[r - OUT0_COLOR] = b[i]
    }
    return true
  }

  const i2cRead = (addr, n) => {
    if (!LP5009.includes(addr)) return null
    const r = []
    for (let i = 0; i < n; i++) r.push(lp.regs[(lp.ptr + i) % lp.regs.length])
    return r
  }

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

  return (engine) => {
    const c = (us) => engine.charge(us)
    // a fresh VM: the radio and infrared start over
    air.radio.reset(engine.world.timeUs)
    air.infrared.reset(engine.world.timeUs)
    if (engine.o.files?.['flight_catalog.py']) cf.loadCatalog(engine.o.files['flight_catalog.py'])
    cf.onConsole = (text) => { if (consoleOut) engine.write(new TextEncoder().encode(text.replace(/\n/g, '\r\n'))) }
    consoleOut = false
    return {
      pins: () => PINS,
      temp_c: () => 32.0,
      runtime_us: () => engine.world.timeUs,

      dio_cfg() { c(COST_US.gpio) },
      dio_set(pin, v) {
        c(COST_US.gpio)
        // the flight controller's reset line: low holds it in reset
        if (pin === 'D33') { if (!v) cf.linked = false; else if (!cf.linked) { cf.reset() } }
      },
      dio_get(pin) {
        c(COST_US.gpio)
        if (pin === 'BTN_0') return air.buttons[0] ? 0 : 1
        if (pin === 'BTN_1') return air.buttons[1] ? 0 : 1
        if (pin === 'USB_PGOODN') return air.usb ? 0 : 1
        return 1
      },
      adc(pin) {
        c(COST_US.adc)
        if (pin === 'BATT_MON') return Math.round((air.volts / 2 / 3.3) * 65535 * (1 + 0.002 * air.rng.normal()))
        return 0
      },
      dac() {},
      pwm(pin, duty, freq) { c(COST_US.pwm); if (pin === 'SPK') air.tone = duty > 0 && freq > 0 ? freq : 0 },
      spi_write() {},
      i2c_scan: () => [...LP5009],
      i2c_write(addr, h) { const b = fromHex(h); c(COST_US.i2cStart + COST_US.i2cByte * b.length); return i2cWrite(addr, b) },
      i2c_read(addr, n) { c(COST_US.i2cStart + COST_US.i2cByte * n); return i2cRead(addr, n) },

      btn_was_pressed(n) {
        c(COST_US.gpio)
        const was = air.pressedLatch[n]
        air.pressedLatch[n] = false
        return was ? 1 : 0
      },
      pixels(list) {
        c(40)
        const v = list.split(',').map(Number)
        for (let i = 0; i < 8; i++) air.pixels[i] = [v[i * 3] ?? 0, v[i * 3 + 1] ?? 0, v[i * 3 + 2] ?? 0]
      },

      // crtp: the UART to the flight controller (a 30-byte packet takes
      // about 0.7 ms at 460800 baud)
      crtp_init(on) { cf.linked = !!on },
      crtp_send(port, ch, h) {
        const b = Uint8Array.from(fromHex(h))
        c(COST_US.crtpCall + COST_US.uartByte * (b.length + 4))
        cf.send(port, ch, b)
      },
      crtp_receive() {
        c(COST_US.crtpCall)
        const p = cf.rx.shift()
        return p ? [p[0], p[1], hex(p[2])] : null
      },
      crtp_flush() { c(COST_US.crtpCall); cf.rx = [] },
      crtp_log_avail() { c(COST_US.crtpCall); return cf.logq.length ? 1 : 0 },
      crtp_log_read() {
        c(COST_US.crtpCall)
        const p = cf.logq.shift()
        return p ? [p[0], p[1], hex(p[2])] : null
      },
      crtp_console_read() { const s = cf.console; cf.console = ''; return s },
      crtp_console_stdout(on) { consoleOut = !!on },

      // the radio (world/radio.js): the module's settings, a send, the next message heard
      radio_set(on, channel) { c(COST_US.gpio); air.radio.set(on, channel, engine.world.timeUs) },
      radio_send(message) { c(2000); air.radio.send(message, engine.world.timeUs) },
      radio_receive() { c(COST_US.gpio); return air.radio.receive(engine.world.timeUs) },

      // infrared (world/infrared.js), as pulseio's PulseOut and PulseIn
      ir_send(csv) {
        const pulses = csv ? csv.split(',').map(Number) : []
        air.infrared.send(pulses, engine.world.timeUs)
        c(pulses.reduce((a, b) => a + b, 0))       // PulseOut.send blocks while it sends
      },
      ir_open(maxlen) { air.infrared.open(maxlen) },
      ir_len() { c(COST_US.gpio); return air.infrared.length(engine.world.timeUs) },
      ir_get(i) { return air.infrared.get(i) },
      ir_popleft() { return air.infrared.popleft() },
      ir_clear() { air.infrared.clear() },
      ir_pause(on) { air.infrared.pause(on, engine.world.timeUs) },
    }
  }
}
