// Deterministic maths for the simulation's state.
//
// Math.sin, Math.cos and friends are not specified bit-exact, and browsers do
// differ in the last bits; over thousands of steps that becomes a different
// path. Addition, multiplication, division and Math.sqrt are exact IEEE 754 in
// every engine, so everything that feeds the state is built from them.

const HALF_PI = Math.PI / 2
const TWO_PI = Math.PI * 2

// Angle to (-PI, PI].
export function wrapAngle(a) {
  if (a > Math.PI || a <= -Math.PI) a -= TWO_PI * Math.round(a / TWO_PI)
  if (a <= -Math.PI) a += TWO_PI
  return a
}

function sinPoly(r) {
  const r2 = r * r
  return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800))))))
}

function cosPoly(r) {
  const r2 = r * r
  return 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600))))))
}

// Sine and cosine together, to about 1e-12, from exact operations only.
export function sincos(a) {
  const k = Math.round(a / HALF_PI)
  const r = a - k * HALF_PI
  const s = sinPoly(r), c = cosPoly(r)
  switch (((k % 4) + 4) % 4) {
    case 0: return [s, c]
    case 1: return [c, -s]
    case 2: return [-s, -c]
    default: return [-c, s]
  }
}

export const sin = (a) => sincos(a)[0]
export const cos = (a) => sincos(a)[1]

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
