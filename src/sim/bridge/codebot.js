// The `_sim` module botcore.py calls: the CodeBot model's side of each part.
//
// Each call charges the simulated time the operation takes on a CB3 (an ADC
// conversion, an I2C transfer, a proximity pulse train), so a program's
// timing follows the device's. These costs are estimates until measured.
const COST_US = {
  write: 20,        // a GPIO or LED-driver write
  adc: 60,          // one ADC conversion
  i2c: 400,         // an accelerometer read
  proxPulse: 1200,  // one proximity detect, both emitters swept
}

export function codebotBridge(bot) {
  return (engine) => {
    const c = (us) => engine.charge(us)
    return {
      motors_run(n, pct) { c(COST_US.write); bot.setPower(n, pct) },
      motors_enable(on) { c(COST_US.write); bot.enable(on) },

      ls_read(n) { c(COST_US.adc); return bot.lineRead(n) },
      enc_read(n) { c(COST_US.adc); return bot.encRead(n) },

      prox_read(n) { c(COST_US.adc); return bot.proxRead(n) },
      prox_detect(n, power, sens) { c(COST_US.proxPulse / 2); return bot.proxDetect(n, power, sens) },
      // Successive approximation over sensitivity, as the device does: the
      // least sensitivity at which the sensor still sees something.
      prox_range(n, samples, power, lo, hi) {
        let found = -1
        let a = lo, b = hi
        if (!bot.proxDetect(n, power, b)) { c(COST_US.proxPulse / 2); return -1 }
        found = b
        for (let i = 1; i < samples && a <= b; i++) {
          c(COST_US.proxPulse / 2)
          const mid = Math.floor((a + b) / 2)
          if (bot.proxDetect(n, power, mid)) { found = mid; b = mid - 1 } else { a = mid + 1 }
        }
        return found
      },

      accel_read() { c(COST_US.i2c); return bot.accelRead() },

      btn_is(n) { c(COST_US.write); return bot.buttons[n] },
      btn_was(n) { c(COST_US.write); return bot.wasPressed(n) },

      led_set(group, v) { c(COST_US.write); bot.leds[group] = group === 'pwr' || group === 'usb' ? !!v : v },
      led_bit(group, i, on) {
        c(COST_US.write)
        bot.leds[group] = on ? bot.leds[group] | (1 << i) : bot.leds[group] & ~(1 << i)
      },

      tone(freq) { c(COST_US.write); bot.tone = freq },

      pwr_is_usb() { return false },
      pwr_volts() { c(COST_US.adc); return bot.volts },
      temp_c() { c(COST_US.adc); return 23.5 },
    }
  }
}
