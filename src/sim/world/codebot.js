// CodeBot CB3: a differential-drive robot on the floor plane, with the
// hardware botcore exposes (motors, line sensors, proximity, encoders,
// accelerometer, buttons, LEDs, speaker).
//
// A purpose-built model, not a physics engine: each behaviour is a named
// parameter below. Pose is the midpoint of the drive axle; heading points
// forward; the body frame has +x forward and +y to the robot's left.
import { sincos, wrapAngle, clamp } from './fmath.js'
import { Environment } from './environment.js'

// Physical parameters. Positions are from the CB3 3D model (BotBody.glb: its
// motor shaft is the axle, 56 mm behind the model's origin). The drive is a DC
// gearmotor model from the hardware: botcore's H-bridge (sign and 1 kHz PWM,
// standby to disable), the gearmotors' no-load speed and stall torque, the
// battery, the robot's mass, and the friction of the gears, the tyres and the
// skid. Every value marked (assumed) or (typical) is listed in sim/DESIGN.md
// "Calibration" to be confirmed on a CB3 in the final testing rounds.
export const CB3 = {
  wheelRadius: 0.0325,        // 65 mm wheels
  track: 0.111,               // wheel centre to wheel centre
  bodyRadius: 0.077,          // collision circle, around the body centre
  bodyCenter: 0.0435,         // body centre ahead of the axle (153 mm long body)
  height: 0.05,               // the band in which it meets obstacles
  step: 0.01,                 // a ledge this low it drives over; higher, it drives off

  // Battery: four AA cells in series. (assumed: fresh alkaline)
  nominalVolts: 6.0,
  batteryOhms: 0.6,           // the pack's internal resistance, 0.15 per cell (assumed)
  // Gearmotors, at the wheel, at 6 V across the motor: the yellow 1:48 "TT"
  // gearmotor (plastic gears) driving a 65 mm wheel. (typical: published
  // figures for the TT motor at 6 V, not yet measured on a CB3's own)
  motorNoLoad: 20.9,          // rad/s, no load (200 rpm)
  motorStallTorque: 0.078,    // N m (0.8 kg cm)
  motorStallAmps: 1.5,        // so the winding is 4 ohms
  motorNoLoadAmps: 0.16,      // what it draws spinning free: its own friction
  wheelInertia: 1.4e-4,       // kg m^2 per wheel: a 130-size rotor's 0.6 g cm^2 through 48:1 (assumed)
  // The H-bridge: its control (two direction pins and a PWM per motor, one
  // standby) is the TB6612FNG's, whose two switches in the motor's path are
  // 0.5 ohm together. (inferred from the interface: the part is not named)
  bridgeOhms: 0.5,
  // Body. (assumed: mass, inertia, the skid's share of the weight, the frictions)
  mass: 0.40,                 // kg, with batteries
  yawInertia: 2.0e-3,         // kg m^2 about the axle's midpoint
  tyreGrip: 0.8,              // friction coefficient, tyre on floor: the most a wheel can push
  rollingResistance: 0.02,    // of each wheel's load
  skidLoad: 0.15,             // share of the weight on the front skid
  skidFriction: 0.25,         // the skid sliding on the floor, any direction
  skidAhead: 0.10,            // m ahead of the axle

  // Line sensors: 0 is the robot's left, 4 its right. Each is a QRE1113GR, a
  // 940 nm infrared emitter (40 mA at botcore's default power, 20 mA at the
  // lower) beside a phototransistor on a pull-up into the ADC: reflected light
  // pulls the reading down from dark, linearly, until the phototransistor
  // saturates. (assumed: the levels, which turn on the pull-up and each part's
  // gain; the floor's visible reflectance stands in for its infrared one)
  lineSensors: [0.0191, 0.0097, 0, -0.0097, -0.0191].map((left) => [0.116, left]),
  lineSpot: 0.004,            // radius of the floor area each sensor sees (assumed)
  lineDark: 4080,             // no light back (dark current under 100 nA): a CB2 read 4080, botcore matches the CB3 to it
  lineSaturated: 150,         // the phototransistor fully on: 0.1 V (assumed; the datasheet's most is 0.3 V, about 450)
  lineSpan: 4400,             // counts pulled down per unit reflectance, emitter at full (assumed)
  lineNoise: 25,

  // Proximity: 0 is left, 1 right; they look straight ahead.
  proxSensors: [[0.1156, 0.0358], [0.1156, -0.0358]],
  proxHeight: 0.03,
  proxHalfAngle: 0.26,        // rad, half the beam's spread
  proxRays: 7,
  // Detection range (cm) = slope * sensitivity + intercept, per power level
  // 1..8, measured on a physical CodeBot for CodeSpace.
  proxTable: [[0.128, 6.7], [0.148, 12.2], [0.173, 14.7], [0.198, 17.2],
    [0.215, 19.8], [0.232, 22.4], [0.270, 23.3], [0.307, 24.1]],

  encoderSlots: 20,           // a slotted disc on the wheel's shaft, read by an infrared slot sensor
  encoderNoise: 300,

  accelPerG: 16384,           // +-2 g full scale, signed 16-bit
  accelNoise: 60,
  gravity: 9.80665,
}

export class CodeBot {
  // z: the floor it starts on (a stage); 0, the room's floor, if not given.
  constructor(env, rng, { x = 0, y = 0, z = 0, heading = 0, id = 'codebot', params = CB3 } = {}) {
    this.kind = 'codebot'
    this.id = id
    this.env = env
    this.rng = rng
    this.p = params
    this.drive = CodeBot.driveConstants(params)
    this.reset(x, y, heading, z)
  }

  // The motor's constants from its datasheet numbers. At the wheel, a motor
  // gives torque kt * i - gearFriction, and i = (V - ke * w) / R. Spinning free
  // it draws just the current its own friction takes (gearFriction = kt * i0);
  // that, stall (w = 0) and no load (torque 0) at the nominal voltage fix kt,
  // ke and the friction.
  static driveConstants(p) {
    const motorOhms = p.nominalVolts / p.motorStallAmps
    const kt = p.motorStallTorque / (p.motorStallAmps - p.motorNoLoadAmps)
    const gearFriction = kt * p.motorNoLoadAmps
    const ke = (p.nominalVolts - p.motorNoLoadAmps * motorOhms) / p.motorNoLoad
    const weight = p.mass * p.gravity
    const r2 = p.wheelRadius * p.wheelRadius
    const b = p.track / 2
    return {
      kt, ke, gearFriction,
      ohms: motorOhms + p.bridgeOhms,
      massV: p.mass + (2 * p.wheelInertia) / r2,                  // forward, wheels' inertia included
      inertiaW: p.yawInertia + (2 * p.wheelInertia * b * b) / r2, // turning, likewise
      wheelLoad: (weight * (1 - p.skidLoad)) / 2,
      skidLoad: weight * p.skidLoad,
    }
  }

  reset(x, y, heading, z = 0) {
    this.x = x; this.y = y; this.heading = heading
    // on the floor nearest the height asked, as stepping would put it
    const [s, c] = sincos(heading)
    this.setLevel(this.env.supportAt(x + this.p.bodyCenter * c, y + this.p.bodyCenter * s, z, this.p.step))
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

  // The floor it is on: the height of its wheels, and so what it can bump
  // into (whatever reaches above a climbable step and below its top).
  setLevel(z) {
    this.z = z
    this.boxes = this.env.obstaclesIn(z + this.p.step, z + this.p.height)
  }

  step(dt) {
    const p = this.p, k = this.drive
    const v0 = this.v
    const r = p.wheelRadius, b = p.track / 2

    // The motors' pull at the floor. botcore sets each motor's direction and
    // its PWM duty from the power; in the off part of each 1 ms period the
    // bridge shorts the motor, so on average it sees duty x battery volts and
    // brakes as readily as it drives. At power 0, or disabled, the bridge
    // lets go and the motor coasts. A wheel pushes no harder than its grip.
    const force = [0, 0]
    let batteryAmps = 0
    for (let i = 0; i < 2; i++) {
      const pw = this.power[i]
      if (!this.enabled || pw === 0) continue
      const duty = Math.abs(pw) / 100
      const amps = (Math.sign(pw) * duty * this.volts - k.ke * this.wheel[i]) / k.ohms
      batteryAmps += duty * Math.sign(pw) * amps
      const grip = p.tyreGrip * k.wheelLoad
      force[i] = clamp((k.kt * amps) / r, -grip, grip)
    }
    // What the battery delivers sags with the current drawn (next step's).
    this.volts = p.nominalVolts - p.batteryOhms * Math.max(0, batteryAmps)

    let v = this.v + (dt * (force[0] + force[1])) / k.massV
    let om = this.omega + (dt * (force[1] - force[0]) * b) / k.inertiaW

    // Friction, as impulses that can stop a motion but never reverse it (so a
    // robot at rest stays at rest until the motors overcome it: the deadband):
    // each wheel's gears and rolling resistance against that wheel's speed over
    // the floor, and the skid against its own sliding. A few passes settle them.
    const iv = 1 / k.massV, iw = 1 / k.inertiaW
    const wheelMax = (k.gearFriction / r +p.rollingResistance * k.wheelLoad) * dt
    const skidMax = p.skidFriction * k.skidLoad * dt
    const a = p.skidAhead
    const wheelMass = 1 / (iv + b * b * iw)
    const acc = [0, 0], skid = [0, 0]
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < 2; i++) {
        const s = i ? b : -b
        const old = acc[i]
        acc[i] = clamp(old - wheelMass * (v + s * om), -wheelMax, wheelMax)
        const d = acc[i] - old
        v += d * iv
        om += d * s * iw
      }
      let nx = skid[0] - k.massV * v
      let ny = skid[1] - (om * a) / (a * a * iw)
      const n = Math.hypot(nx, ny)
      if (n > skidMax) { nx *= skidMax / n; ny *= skidMax / n }
      v += (nx - skid[0]) * iv
      om += (ny - skid[1]) * a * iw
      skid[0] = nx; skid[1] = ny
    }
    this.wheel[0] = (v - b * om) / r
    this.wheel[1] = (v + b * om) / r

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

    // Off the edge of a stage: once the body's centre is over the drop it
    // falls, and lands on its wheels. (A real one would tumble; this one
    // carries on, a simplification.) Onto a step it can climb, it climbs.
    const ground = this.env.supportAt(x + p.bodyCenter * c2, y + p.bodyCenter * s2, this.z, p.step)
    if (ground < this.z) {
      // It tips off forward (or back, reversing), and lands clear of the ledge.
      this.setLevel(ground)
      const dir = v >= 0 ? 1 : -1
      for (let d = 0; d <= 2 * p.bodyRadius; d += 0.005) {
        const lx = this.x + dir * d * c2, ly = this.y + dir * d * s2
        if (!Environment.pushOut(lx + p.bodyCenter * c2, ly + p.bodyCenter * s2, p.bodyRadius, this.boxes).hit) {
          this.x = lx; this.y = ly
          break
        }
      }
    } else if (ground > this.z) this.setLevel(ground)
    this.wheelAngle[0] += this.wheel[0] * dt
    this.wheelAngle[1] += this.wheel[1] * dt

    // Body-frame acceleration (forward, left), lightly filtered; a collision
    // shows as the sudden stop it is.
    const ax = (v - v0) / dt
    const ay = v * om
    const f = dt / 0.01
    this.accelBody[0] += (ax - this.accelBody[0]) * f
    this.accelBody[1] += (ay - this.accelBody[1]) * f
  }

  // A body-frame point (forward, left) in the world.
  toWorld(fwd, left) {
    const [s, c] = sincos(this.heading)
    return [this.x + fwd * c - left * s, this.y + fwd * s + left * c]
  }

  // --- what botcore reads and writes --------------------------------------

  // A program ended: the board resets its pins, so the motors and speaker stop.
  programEnded() {
    this.enabled = false
    this.tone = 0
  }

  setPower(n, pct) { this.power[n] = clamp(pct, -100, 100) }
  enable(on) { this.enabled = !!on }

  // Line sensor n's 12-bit reading (0 brightest) with its emitter on at
  // `gain` (1 at full power): reflected light pulls it down from dark. Over
  // the edge of a stage nothing comes back, as over black.
  lineRead(n, gain = 1) {
    const p = this.p
    const [wx, wy] = this.toWorld(...p.lineSensors[n])
    const over = this.env.supportAt(wx, wy, this.z, p.step) < this.z - p.step
    const r = over ? 0 : this.env.floor.reflectance(wx, wy, p.lineSpot)
    const lit = Math.max(p.lineSaturated, p.lineDark - p.lineSpan * r * gain)
    return Math.round(clamp(lit + p.lineNoise * this.rng.normal(), 0, 4095))
  }

  // A line sensor's reading with its emitter off: only ambient light.
  lineDark() {
    return Math.round(clamp(this.p.lineDark + this.p.lineNoise * this.rng.normal(), 0, 4095))
  }

  // Distance (m) from proximity sensor n to the nearest obstacle in its beam.
  proxDistance(n) {
    const p = this.p
    const [fwd, left] = p.proxSensors[n]
    const [ox, oy] = this.toWorld(fwd, left)
    const h = this.z + p.proxHeight
    const boxes = this.env.obstaclesIn(h - 0.005, h + 0.005)
    let best = Infinity
    for (let i = 0; i < p.proxRays; i++) {
      const a = this.heading + p.proxHalfAngle * ((2 * i) / (p.proxRays - 1) - 1)
      const [s, c] = sincos(a)
      const d = Environment.rayCast(ox, oy, c, s, boxes, 1.0)
      if (d < best) best = d
    }
    return best
  }

  // Range (cm) at which a sensor detects, for an emitter power and a
  // sensitivity (0..100, the carrier's nearness to the receivers' frequency).
  static proxRangeCm(params, power, sens) {
    const [m, b] = params.proxTable[power - 1]
    return m * sens + b
  }

  proxDetect(n, power, sens) {
    if (power < 1 || sens < 2) return false
    const d = this.proxDistance(n) * 100 * (1 + 0.03 * this.rng.normal())
    return d <= CodeBot.proxRangeCm(this.p, power, sens)
  }

  encRead(n) {
    const p = this.p
    const phase = (this.wheelAngle[n] * p.encoderSlots) / (2 * Math.PI)
    const inSlot = phase - Math.floor(phase) < 0.5
    const noise = Math.abs(this.rng.normal()) * p.encoderNoise
    return Math.round(inSlot ? 4095 - noise : noise) & 4095
  }

  // What the KXTJ3 measures, signed 16-bit at +-2 g: specific force in the
  // chip's frame (taken as x right, y forward, z up; to be checked on a CB3),
  // so flat and still it measures (0, 0, +1 g).
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
      x: this.x, y: this.y, z: this.z, heading: this.heading,
      wheelAngle: [this.wheelAngle[0], this.wheelAngle[1]],
      leds: { ...this.leds }, tone: this.tone, enabled: this.enabled, blocked: this.blocked,
    }
  }
}
