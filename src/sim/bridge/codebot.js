// The CodeBot CB3's board, simulated at the level its own botcore.py drives
// it: pins, ADC channels, PWM, the I2C chips and the LED shift register. This
// is the `_sim` module the CircuitPython layer (python/common/) calls; the
// device's Python runs on it unchanged.
//
// From the CB3 schematic as botcore and cb3pins describe it:
// - LEDs: a 32-bit shift register written over SPI (LED_CLK, LED_SDI) and
//   latched on LED_LE; LED_OE low enables it. Bits 0-5 line-sensor emitters
//   (two bits of power for each pair), 6-7 encoder emitters, 8-15 user LEDs,
//   16-20 line-sensor LEDs, 21-22 proximity LEDs, 23 power LED, 24-31
//   proximity emitter power.
// - Motors: a PCA9557 at 0x1C (IN1, IN2 per motor, STBY) and PWM duty on
//   ML_PWM and MR_PWM.
// - Accelerometer: a KXTJ3 at 0x0E.
// - Proximity: IR receivers on PROX_L and PROX_R (low when they see the
//   carrier), the carrier's frequency on PROX_PWM: the nearer it is to the
//   receivers' 56 kHz, the farther they see.
// - Line sensors and encoders: ADC channels, read with their emitters on.

import { KXTJ3, fromHex } from './chips.js'

const PINS = [
  'IO0', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13',
  'IO14', 'IO15', 'IO16', 'IO17', 'IO18', 'IO19', 'IO20', 'IO21', 'IO26', 'IO33', 'IO34', 'IO35', 'IO36',
  'IO37', 'IO38', 'IO39', 'IO40', 'IO41', 'IO42', 'IO43', 'IO44', 'IO45', 'IO46', 'TX', 'RX', 'SCL', 'SDA',
]
const PIN = {
  BTN_0: 'IO0', BTN_1: 'IO21', N_IS_USB: 'IO38', USB_LED: 'IO34',
  LS: ['IO5', 'IO4', 'IO3', 'IO2', 'IO1'],          // LS0 .. LS4 (cb3pins)
  BATT: 'IO6', ENC: ['IO9', 'IO10'], PROX: ['IO13', 'IO14'],
  ML_PWM: 'IO15', MR_PWM: 'IO16', PROX_PWM: 'IO33',
  LED_LE: 'IO39', LED_CLK: 'IO41', LED_OE: 'IO42',
}
const PCA_ADDR = 0x1c, KXTJ3_ADDR = 0x0e
const MOTOR = { L_IN1: 0x04, L_IN2: 0x08, R_IN1: 0x20, R_IN2: 0x02, STBY: 0x10 }
const LS_EMIT_OFS = [2, 0, 4, 2, 0]                   // botcore.ls_emit
const VOLTAGE_RATIO = (59 + 107) / 59
const LS_ADJUST = 1.215                               // botcore.read_value_and_adjust

// Device time each operation takes (estimates until measured; DESIGN.md).
const COST_US = { gpio: 2, adc: 40, pwm: 15, i2cByte: 25, i2cStart: 60, spiByte: 2 }

export function codebotBridge(bot) {
  const out = new Map()          // output pin levels
  const pwm = new Map()          // pin -> { duty, freq }
  let shift = 0                  // the LED shift register, before latching
  let leds = 0                   // latched
  let pca = { ptr: 0, regs: [0, 0, 0xf0, 0xff] }
  // What the chip measures; botcore's read turns it into what the program
  // sees (x as is, y and z negated: flat, z reads -1 g).
  const kx = new KXTJ3(() => bot.accelRead())

  const applyLeds = () => {
    const on = out.get(PIN.LED_OE) === 0
    const v = on ? leds : 0
    bot.leds.user = (v >>> 8) & 0xff
    bot.leds.ls = (v >>> 16) & 0x1f
    bot.leds.prox = (v >>> 21) & 0x3
    bot.leds.pwr = !!((v >>> 23) & 1)
  }

  const applyMotors = () => {
    const o = pca.regs[1]
    bot.enable(!!(o & MOTOR.STBY))
    const side = (in1, in2, pin) => {
      const duty = pwm.get(pin)?.duty ?? 0
      const pct = (duty * 100) / 65535
      if (o & in2 && !(o & in1)) return pct
      if (o & in1 && !(o & in2)) return -pct
      return 0
    }
    bot.setPower(0, side(MOTOR.L_IN1, MOTOR.L_IN2, PIN.ML_PWM))
    bot.setPower(1, side(MOTOR.R_IN1, MOTOR.R_IN2, PIN.MR_PWM))
  }

  // The proximity receivers: does sensor n see the carrier, with the emitters
  // at the power the register sets and the carrier at the frequency PWM sets?
  const proxSees = (n) => {
    if (out.get(PIN.LED_OE) !== 0) return false
    const level = [0, 1, 3, 7, 15].indexOf((leds >>> 24) & 0x0f)   // power 0..4 (botcore.prox_emit)
    const carrier = pwm.get(PIN.PROX_PWM)
    if (level <= 0 || !carrier?.duty) return false
    const sens = ((carrier.freq - 40000) / (54000 - 40000)) * 100
    return bot.proxDetect(n, level, Math.max(0, Math.min(100, sens)))
  }

  // Encoder and line-sensor channels as the 16-bit ADC sees them.
  const adc = (pin) => {
    const ls = PIN.LS.indexOf(pin)
    if (ls >= 0) {
      const power = (leds >>> LS_EMIT_OFS[ls]) & 0x3
      const lit = out.get(PIN.LED_OE) === 0 && power > 0
      const reading = lit ? bot.lineRead(ls, power === 1 ? 0.5 : 1) : bot.lineDark()
      return Math.min(65535, Math.round((reading * 16) / LS_ADJUST))
    }
    const enc = PIN.ENC.indexOf(pin)
    if (enc >= 0) {
      const lit = out.get(PIN.LED_OE) === 0 && (leds >>> (6 + enc)) & 1
      return lit ? bot.encRead(enc) * 16 : 0
    }
    if (pin === PIN.BATT) return Math.round((bot.volts / VOLTAGE_RATIO / 3.3) * 65535)
    return 0
  }

  const i2cWrite = (addr, bytes) => {
    if (addr === PCA_ADDR) {
      pca.ptr = bytes[0] & 3
      if (bytes.length > 1) {
        pca.regs[pca.ptr] = bytes[1]
        if (pca.ptr === 1) applyMotors()
      }
      return true
    }
    if (addr === KXTJ3_ADDR) return kx.write(bytes)
    return false
  }

  const i2cRead = (addr, n) => {
    if (addr === PCA_ADDR) return [pca.ptr === 0 ? pca.regs[1] : pca.regs[pca.ptr]]
    if (addr === KXTJ3_ADDR) return kx.read(n)
    return null
  }

  return (engine) => {
    const c = (us) => engine.charge(us)
    return {
      pins: () => PINS,
      temp_c: () => 31.5,
      runtime_us: () => engine.world.timeUs,

      dio_cfg(pin, dir) { c(COST_US.gpio); if (!dir) out.delete(pin) },
      dio_set(pin, v) {
        c(COST_US.gpio)
        const was = out.get(pin)
        out.set(pin, v)
        if (pin === PIN.LED_LE && was === 1 && v === 0) { leds = shift; applyLeds() }
        if (pin === PIN.LED_LE && v === 1) { leds = shift; applyLeds() }
        if (pin === PIN.LED_OE) applyLeds()
        if (pin === PIN.USB_LED) bot.leds.usb = !!v
      },
      dio_get(pin) {
        c(COST_US.gpio)
        if (out.has(pin)) return out.get(pin)
        if (pin === PIN.BTN_0) return bot.buttons[0] ? 0 : 1
        if (pin === PIN.BTN_1) return bot.buttons[1] ? 0 : 1
        if (pin === PIN.N_IS_USB) return 0                  // on batteries
        const p = PIN.PROX.indexOf(pin)
        if (p >= 0) return proxSees(p) ? 0 : 1
        return 1
      },
      adc(pin) { c(COST_US.adc); return adc(pin) },
      dac() { c(COST_US.gpio) },
      pwm(pin, duty, freq) {
        c(COST_US.pwm)
        pwm.set(pin, { duty, freq })
        if (pin === PIN.ML_PWM || pin === PIN.MR_PWM) applyMotors()
      },
      spi_write(clk, hex) {
        const bytes = fromHex(hex)
        c(COST_US.spiByte * bytes.length)
        if (clk === PIN.LED_CLK) for (const b of bytes) shift = ((shift << 8) | b) >>> 0
      },
      i2c_scan: () => [KXTJ3_ADDR, PCA_ADDR],
      i2c_write(addr, hex) {
        const bytes = fromHex(hex)
        c(COST_US.i2cStart + COST_US.i2cByte * bytes.length)
        return i2cWrite(addr, bytes)
      },
      i2c_read(addr, n) { c(COST_US.i2cStart + COST_US.i2cByte * n); return i2cRead(addr, n) },

      btn_was(n) { return bot.wasPressed(n) },
      tone(freq) { c(COST_US.gpio); bot.tone = freq },
    }
  }
}

