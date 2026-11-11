// The simulation's only source of randomness: sfc32, seeded, so a run can be
// repeated exactly. Never use Math.random in the world.
export class Rng {
  constructor(seed = 1) {
    this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = seed >>> 0
    for (let i = 0; i < 12; i++) this.u32()
  }

  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0
    this.d = (this.d + 1) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.c = (this.c + t) | 0
    return t >>> 0
  }

  // Uniform in [0, 1).
  float() {
    return this.u32() / 4294967296
  }

  // Roughly normal, mean 0 and standard deviation 1 (the sum of four
  // uniforms: no logarithms, which are not exact across engines).
  normal() {
    return (this.float() + this.float() + this.float() + this.float() - 2) * 1.7320508075688772
  }

  // A child generator for one device or sensor, so adding one does not shift
  // every other's sequence.
  fork() {
    return new Rng(this.u32())
  }
}
