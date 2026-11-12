// I2C chips more than one board has, simulated at their registers.

// Kionix KXTJ3 accelerometer: a register file whose X/Y/Z outputs are read
// from `measure()`, signed 16-bit (1 g = 16384 at +-2 g), in the chip's frame.
export class KXTJ3 {
  constructor(measure) {
    this.measure = measure
    this.ptr = 0
    this.regs = new Uint8Array(0x80)
    this.regs[0x0f] = 0x35          // WHO_AM_I
  }

  write(bytes) {
    this.ptr = bytes[0] & 0x7f
    for (let i = 1; i < bytes.length; i++) this.regs[(this.ptr + i - 1) & 0x7f] = bytes[i]
    return true
  }

  read(n) {
    if (this.ptr === 0x06) {
      const put = (o, v) => {
        v = Math.max(-32768, Math.min(32767, Math.round(v))) & 0xffff
        this.regs[o] = v & 0xff
        this.regs[o + 1] = v >> 8
      }
      const [x, y, z] = this.measure()
      put(0x06, x); put(0x08, y); put(0x0a, z)
    }
    const r = []
    for (let i = 0; i < n; i++) r.push(this.regs[(this.ptr + i) & 0x7f])
    return r
  }
}

export function fromHex(hex) {
  const b = []
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16))
  return b
}
