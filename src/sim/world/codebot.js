// CodeBot CB3: a differential-drive robot on the floor plane, with the
// hardware botcore exposes (motors, line sensors, proximity, encoders,
// accelerometer, buttons, LEDs, speaker).
//
// A purpose-built model, not a physics engine: each behaviour is a named
// parameter below. Pose is the midpoint of the drive axle; heading points
// forward; the body frame has +x forward and +y to the robot's left.
import { sincos, wrapAngle, clamp } from './fmath.js'
import { Environment } from './environment.js'

// Physical parameters. Dimensions are from CodeSpace's CodeBot model and the
// motor and sensor curves are first estimates: all of them are to be measured
// on a CB3 (see sim/DESIGN.md, "Calibration").
export const CB3 = {
  wheelRadius: 0.0325,        // 65 mm wheels
  track: 0.111,               // wheel centre to wheel centre
  bodyRadius: 0.072,          // collision circle, around the body centre
  bodyCenter: 0.0355,         // body centre ahead of the axle
  height: 0.05,               // the band in which it meets obstacles

  wheelMaxSpeed: 22,          // rad/s at 100% power, unloaded (3.5 rev/s)
  deadband: 12,               // % power below which the wheels do not turn
  motorTau: 0.08,             // s, first-order lag of wheel speed
  coastTau: 0.25,             // s, wheel slow-down with the motors disabled
  traction: 4.0,              // m/s^2, the most the floor gives a wheel
  nominalVolts: 6.0,

  // Line sensors: 0 is the robot's left, 4 its right.
  lineSensors: [0.0191, 0.0097, 0, -0.0097, -0.0191].map((left) => [0.0965, left]),
  lineSpot: 0.003,            // radius of the area each sensor sees
  lineWhite: 180,             // ADC reading on white (0 is brightest)
  lineBlack: 3900,            // ADC reading on black
  lineNoise: 25,

  // Proximity: 0 is left, 1 right; they look straight ahead.
  proxSensors: [[0.0951, 0.0358], [0.0951, -0.0358]],
  proxHeight: 0.03,
  proxHalfAngle: 0.26,        // rad, half the beam's spread
  proxRays: 7,
  // Detection range (cm) = slope * sensitivity + intercept, per power level
  // 1..8, measured on a physical CodeBot for CodeSpace.
  proxTable: [[0.128, 6.7], [0.148, 12.2], [0.173, 14.7], [0.198, 17.2],
    [0.215, 19.8], [0.232, 22.4], [0.270, 23.3], [0.307, 24.1]],

  encoderSlots: 20,
  encoderNoise: 300,

  accelPerG: 16384,           // +-2 g full scale, signed 16-bit
  accelNoise: 60,
  gravity: 9.80665,
}

export class CodeBot {
  constructor(env, rng, { x = 0, y = 0, heading = 0, id = 'codebot', params = CB3 } = {}) {
    this.kind = 'codebot'
    this.id = id
    this.env = env
    this.rng = rng
    this.p = params
    this.boxes = env.obstaclesIn(0, params.height)
    this.reset(x, y, heading)
  }

  reset(x, y, heading) {
    this.x = x; this.y = y; this.heading = heading
    this.v = 0; this.omega = 0                     // body speed (m/s) and turn rate (rad/s)
    this.wheel = [0, 0]                            // wheel speeds, rad/s
    this.wheelAngle = [0, 0]
    this.power = [0, 0]
    this.enabled = false
    this.blocked = false
    this.accelBody = [0, 0]                        // filtered body-frame acceleration, m/s^2
    this.volts = this.p.nominalVolts
    this.leds = { user: 0, ls: 0, prox: 0, pwr: true, usb: false }
    this.tone = 0
    this.buttons = [false, false]
    this.pressedLatch = [false, false]
  }

  // --- the model --------------------------------------------------------

  step(dt) {
    const p = this.p
    const v0 = this.v

    for (let i = 0; i < 2; i++) {
      const pw = this.power[i]
      let target = 0
      if (this.enabled && Math.abs(pw) > p.deadband) {
        target = Math.sign(pw) * ((Math.abs(pw) - p.deadband) / (100 - p.deadband)) * p.wheelMaxSpeed * (this.volts / p.nominalVolts)
      }
      const tau = this.enabled ? p.motorTau : p.coastTau
      let dw = (target - this.wheel[i]) * (dt / tau)
      const maxDw = (p.traction / p.wheelRadius) * dt
      dw = clamp(dw, -maxDw, maxDw)
      this.wheel[i] += dw
    }

    let v = (p.wheelRadius * (this.wheel[0] + this.wheel[1])) / 2
    let om = (p.wheelRadius * (this.wheel[1] - this.wheel[0])) / p.track

    // Move, then push the body out of anything it hit.
    const [s0, c0] = sincos(this.heading)
    const heading = wrapAngle(this.heading + om * dt)
    const [s1, c1] = sincos(this.heading + (om * dt) / 2)
    let x = this.x + v * c1 * dt
    let y = this.y + v * s1 * dt
    const [s2, c2] = sincos(heading)
    const bx = x + p.bodyCenter * c2, by = y + p.bodyCenter * s2
    const out = Environment.pushOut(bx, by, p.bodyRadius, this.boxes)
    this.blocked = out.hit
    if (out.hit) {
      x = out.x - p.bodyCenter * c2
      y = out.y - p.bodyCenter * s2
      // What really happened: the wheels turn only as far as the body moved,
      // so they stall against a wall and the encoders stop.
      const dx = x - this.x, dy = y - this.y
      v = (dx * c0 + dy * s0) / dt
      const half = (om * p.track) / 2
      this.wheel[0] = (v - half) / p.wheelRadius
      this.wheel[1] = (v + half) / p.wheelRadius
    }
    this.x = x; this.y = y; this.heading = heading
    this.v = v; this.omega = om
    this.wheelAngle[0] += this.wheel[0] * dt
    this.wheelAngle[1] += this.wheel[1] * dt

    // Body-frame acceleration (forward, left), lightly filtered; a collision
    // shows as the sudden stop it is.
    const ax = (v - v0) / dt
    const ay = v * om
    const k = dt / 0.01
    this.accelBody[0] += (ax - this.accelBody[0]) * k
    this.accelBody[1] += (ay - this.accelBody[1]) * k
  }

  // A body-frame point (forward, left) in the world.
  toWorld(fwd, left) {
    const [s, c] = sincos(this.heading)
    return [this.x + fwd * c - left * s, this.y + fwd * s + left * c]
  }

  // --- what botcore reads and writes --------------------------------------

  setPower(n, pct) { this.power[n] = clamp(pct, -100, 100) }
  enable(on) { this.enabled = !!on }

  lineRead(n) {
    const p = this.p
    const [wx, wy] = this.toWorld(...p.lineSensors[n])
    const r = this.env.floor.reflectance(wx, wy, p.lineSpot)
    const raw = p.lineBlack + (p.lineWhite - p.lineBlack) * r + p.lineNoise * this.rng.normal()
    return Math.round(clamp(raw, 0, 4095))
  }

  // Distance (m) from proximity sensor n to the nearest obstacle in its beam.
  proxDistance(n) {
    const p = this.p
    const [fwd, left] = p.proxSensors[n]
    const [ox, oy] = this.toWorld(fwd, left)
    const boxes = this.env.obstaclesIn(p.proxHeight - 0.005, p.proxHeight + 0.005)
    let best = Infinity
    for (let i = 0; i < p.proxRays; i++) {
      const a = this.heading + p.proxHalfAngle * ((2 * i) / (p.proxRays - 1) - 1)
      const [s, c] = sincos(a)
      const d = Environment.rayCast(ox, oy, c, s, boxes, 1.0)
      if (d < best) best = d
    }
    return best
  }

  // Range (cm) at which sensor detects, for an emitter power and sensitivity.
  static proxRangeCm(params, power, sens) {
    const [m, b] = params.proxTable[power - 1]
    return m * sens + b
  }

  proxDetect(n, power, sens) {
    if (power < 1 || sens < 2) return false
    const d = this.proxDistance(n) * 100 * (1 + 0.03 * this.rng.normal())
    return d <= CodeBot.proxRangeCm(this.p, power, sens)
  }

  // The raw reading botcore's prox.read gives: 0 (touching) to 4095 (nothing).
  proxRead(n) {
    const d = this.proxDistance(n) * 100
    return d === Infinity ? 4095 : Math.round(clamp((d / 50) * 4096, 0, 4095))
  }

  encRead(n) {
    const p = this.p
    const phase = (this.wheelAngle[n] * p.encoderSlots) / (2 * Math.PI)
    const inSlot = phase - Math.floor(phase) < 0.5
    const noise = Math.abs(this.rng.normal()) * p.encoderNoise
    return Math.round(inSlot ? 4095 - noise : noise) & 4095
  }

  // Signed 16-bit (x right, y forward, z up), at rest flat (0, 0, +1 g).
  accelRead() {
    const p = this.p
    const g = p.accelPerG / p.gravity
    const [fwd, left] = this.accelBody
    const n = () => p.accelNoise * this.rng.normal()
    return [Math.round(-left * g + n()), Math.round(fwd * g + n()), Math.round(p.accelPerG + n())]
  }

  press(n, down) {
    if (down && !this.buttons[n]) this.pressedLatch[n] = true
    this.buttons[n] = down
  }

  wasPressed(n) {
    const w = this.pressedLatch[n]
    this.pressedLatch[n] = false
    return w
  }

  snapshot() {
    return {
      id: this.id, kind: this.kind,
      x: this.x, y: this.y, heading: this.heading,
      wheelAngle: [this.wheelAngle[0], this.wheelAngle[1]],
      leds: { ...this.leds }, tone: this.tone, enabled: this.enabled,
    }
  }
}
