// CodeAIR: a small quadcopter, and the board around its flight controller
// (NeoPixels, blue LEDs, buttons, speaker, battery).
//
// The flight is arcade, not real dynamics (sim/DESIGN.md, section 2): the
// flight controller's setpoints (velocities, a height, a yaw rate) are reached
// through first-order lags; seeded Ornstein-Uhlenbeck drift wanders it about
// as a real one wanders; it meets the room's boxes as a flat puck and bounces
// off them. With its motors off it falls. The setpoints come from the
// simulated Crazyflie (crazyflie.js), which keeps the flight controller's own
// rules: a setpoint is good for half a second, and after two seconds without
// one the motors stop.
//
// Pose: (x, y) the centre, z the height of its underside above the floor,
// heading counter-clockwise from +x as for CodeBot.
import { sincos, wrapAngle, clamp } from './fmath.js'
import { Environment } from './environment.js'
import { Crazyflie } from './crazyflie.js'
import { Radio } from './radio.js'
import { Infrared } from './infrared.js'

// Every number is an estimate until it is measured on a CodeAIR (see
// sim/DESIGN.md, "Calibration").
export const AIR = {
  radius: 0.066,              // the prop guards: 132 mm across
  height: 0.034,              // underside to the top of the prop guards
  tauXY: 0.35,                // s, lag to a horizontal velocity setpoint
  tauZ: 0.1,                  // s, lag to a vertical velocity
  tauYaw: 0.12,               // s, lag to a yaw rate
  zGain: 5,                   // 1/s, vertical speed per metre of height error
  maxVz: 1.0,                 // m/s, the most it climbs or sinks under control
  posGain: 1.5,               // 1/s, speed per metre of position error (position setpoints)
  maxV: 1.5,                  // m/s
  drag: 0.6,                  // 1/s, what slows it with no setpoint holding it
  // Drift: Ornstein-Uhlenbeck velocity noise, theta 1/s and sigma m/s/sqrt(s);
  // more of it near the floor, where its own downwash bounces back.
  driftTheta: 0.8,
  driftSigma: 0.03,
  groundEffect: 0.15,         // m, below which drift doubles
  yawDriftSigma: 0.01,        // rad/s/sqrt(s)
  restitution: 0.35,          // off walls and boxes
  floorRestitution: 0.2,
  bounceJitter: 0.25,         // random share added to a bounce's sideways kick
  gravity: 9.80665,
  maxTiltG: 0.35,             // the steepest the picture leans, as a share of g
  stabilizeS: 0.5,            // the flight controller's setpoint timeouts
  shutdownS: 2.0,
  estDriftSigma: 0.004,       // m/sqrt(s), the position estimate's random walk
  volts: 3.9,                 // the battery
}

export class CodeAIR {
  constructor(env, rng, { x = 0, y = 0, heading = 0, id = 'codeair', params = AIR } = {}) {
    this.kind = 'codeair'
    this.id = id
    this.env = env
    this.rng = rng
    this.p = params
    this.cf = new Crazyflie(this)
    this.radio = new Radio(rng)
    this.infrared = new Infrared(rng)
    // A stopped program gets this long (simulated) to finish what its
    // KeyboardInterrupt sets off: `with recorder:` lands, at 0.2 m/s from up
    // to 2 m.
    this.stopGraceUs = 12e6
    this.reset(x, y, heading)
  }

  reset(x, y, heading) {
    this.x = x; this.y = y; this.z = 0; this.heading = heading
    this.vx = 0; this.vy = 0; this.vz = 0; this.yawRate = 0
    this.ax = 0; this.ay = 0; this.az = 0          // world acceleration, m/s^2, last step
    this.roll = 0; this.pitch = 0                  // rad, as drawn and as the estimator reports
    this.rollRate = 0; this.pitchRate = 0
    this.drift = [0, 0, 0]                         // vx, vy (m/s), yaw rate (rad/s)
    this.motors = false
    this.propAngle = 0
    this.bump = 0                                  // g, a knock the accelerometer feels
    this.tUs = 0
    this.est = { x0: x, y0: y, z0: 0, h0: heading, ex: 0, ey: 0 }
    // the board
    this.pixels = Array.from({ length: 8 }, () => [0, 0, 0])
    this.leds = new Array(9).fill(0)               // LP5009 outputs: 0-7 the blue LEDs (reversed), 8 status
    this.buttons = [false, false]
    this.pressedLatch = [false, false]
    this.tone = 0
    this.volts = this.p.volts
    this.usb = false
    this.cf.reset()
  }

  // --- the model --------------------------------------------------------

  step(dt) {
    const p = this.p
    this.tUs += dt * 1e6
    this.cf.step(dt)
    const sp = this.cf.setpointNow(this.tUs)
    const vx0 = this.vx, vy0 = this.vy, vz0 = this.vz
    const [s, c] = sincos(this.heading)
    const onFloor = this.z <= 1e-6

    this.motors = !!sp
    if (sp) {
      // What the flight controller asks for, in the world frame.
      let tvx = 0, tvy = 0, tvz = null, tz = this.z, tyaw = 0
      if (sp.mode === 'hover' || sp.mode === 'velocity') {
        if (sp.world) { tvx = sp.vx; tvy = sp.vy } else { tvx = c * sp.vx - s * sp.vy; tvy = s * sp.vx + c * sp.vy }
        tyaw = sp.yawRate
        if (sp.vz !== undefined) tvz = sp.vz
        else tz = sp.z
      } else if (sp.mode === 'position') {
        const [ex, ey] = this.estimateXY()
        const [hs, hc] = sincos(this.est.h0)
        const dx = sp.x - ex, dy = sp.y - ey
        tvx = p.posGain * (hc * dx - hs * dy)
        tvy = p.posGain * (hs * dx + hc * dy)
        tz = sp.z
        tyaw = clamp(3 * wrapAngle(this.est.h0 + sp.yaw - this.heading), -3, 3)
      } else if (sp.mode === 'level') {
        // A setpoint gone stale: level, holding its height, coasting.
        tvx = this.vx * (1 - p.drag * dt); tvy = this.vy * (1 - p.drag * dt)
        tz = sp.z ?? this.z
      } else if (sp.mode === 'tilt') {
        // Roll and pitch angles: lean, and accelerate along the lean.
        const ax = p.gravity * sp.pitch, ay = -p.gravity * sp.roll
        tvx = this.vx + (c * ax - s * ay) * p.tauXY
        tvy = this.vy + (s * ax + c * ay) * p.tauXY
        tyaw = sp.yawRate
        if (sp.z !== undefined) tz = sp.z
        else tvz = sp.climb ?? 0
      }
      const sp2 = tvx * tvx + tvy * tvy
      if (sp2 > p.maxV * p.maxV) { const k = p.maxV / Math.sqrt(sp2); tvx *= k; tvy *= k }
      if (tvz === null) tvz = clamp(p.zGain * (tz - this.z), -p.maxVz, p.maxVz)

      const airborne = this.z > 0.002 || tvz > 0
      if (airborne) {
        this.driftStep(dt)
        tvx += this.drift[0]; tvy += this.drift[1]; tyaw += this.drift[2]
      }
      this.vx += (tvx - this.vx) * (dt / p.tauXY)
      this.vy += (tvy - this.vy) * (dt / p.tauXY)
      this.vz += (tvz - this.vz) * (dt / p.tauZ)
      this.yawRate += (tyaw - this.yawRate) * (dt / p.tauYaw)
      if (onFloor && this.vz <= 0) { this.vx = 0; this.vy = 0; this.vz = 0; this.yawRate = 0 }
      this.propAngle += 160 * dt
    } else {
      // Motors off: it falls, and on the floor it stays put.
      this.yawRate *= 1 - 2 * dt
      if (onFloor && this.vz <= 0) {
        this.vx *= 1 - 12 * dt; this.vy *= 1 - 12 * dt; this.vz = 0; this.yawRate *= 1 - 12 * dt
      } else {
        this.vz -= p.gravity * dt
        this.vx *= 1 - 0.3 * dt; this.vy *= 1 - 0.3 * dt
      }
    }

    // Move, then meet the room.
    this.heading = wrapAngle(this.heading + this.yawRate * dt)
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt
    this.collide()

    // What it felt, and how it leans.
    this.ax = (this.vx - vx0) / dt; this.ay = (this.vy - vy0) / dt; this.az = (this.vz - vz0) / dt
    const [s1, c1] = sincos(this.heading)
    const fwd = c1 * this.ax + s1 * this.ay, left = -s1 * this.ax + c1 * this.ay
    const lim = p.maxTiltG
    const pitch = this.motors ? clamp(fwd / p.gravity, -lim, lim) : this.pitch * (1 - 5 * dt)
    const roll = this.motors ? clamp(-left / p.gravity, -lim, lim) : this.roll * (1 - 5 * dt)
    // smooth the picture: a real frame does not snap to a new lean
    const k = dt / 0.08
    this.pitchRate = (pitch - this.pitch) * k / dt
    this.rollRate = (roll - this.roll) * k / dt
    this.pitch += (pitch - this.pitch) * k
    this.roll += (roll - this.roll) * k
    this.bump *= 1 - 30 * dt

    // The estimate wanders from the truth while it flies.
    if (this.motors && this.z > 0.002) {
      const q = p.estDriftSigma * Math.sqrt(dt)
      this.est.ex += q * this.rng.normal(); this.est.ey += q * this.rng.normal()
    }
  }

  driftStep(dt) {
    const p = this.p
    const sig = (this.z < p.groundEffect ? 2 : 1) * p.driftSigma * Math.sqrt(dt)
    const d = this.drift
    d[0] += -p.driftTheta * d[0] * dt + sig * this.rng.normal()
    d[1] += -p.driftTheta * d[1] * dt + sig * this.rng.normal()
    d[2] += -p.driftTheta * d[2] * dt + p.yawDriftSigma * Math.sqrt(dt) * this.rng.normal()
  }

  // The puck (radius r, from z to z + height) against the floor and the
  // room's boxes. Each overlap is undone along whichever way is shortest
  // out, and the speed into the surface comes back off it, reduced.
  collide() {
    const p = this.p
    if (this.z < 0) {
      this.z = 0
      if (this.vz < -0.3) this.knock(-this.vz, 2, p.floorRestitution)
      else this.vz = 0
    }
    const boxes = this.env.obstaclesIn(this.z, this.z + p.height)
    for (const b of boxes) {
      const cx = clamp(this.x, b.min[0], b.max[0]), cy = clamp(this.y, b.min[1], b.max[1])
      const dx = this.x - cx, dy = this.y - cy
      const d2 = dx * dx + dy * dy
      if (d2 >= p.radius * p.radius) continue
      const d = Math.sqrt(d2)
      const side = d > 1e-9 ? p.radius - d : Infinity
      const up = b.max[2] - this.z                    // to sit on top of it
      const down = this.z + p.height - b.min[2]       // to sit under it
      if (up <= side && up <= down) {
        this.z = b.max[2]
        if (this.vz < -0.3) this.knock(-this.vz, 2, p.floorRestitution)
        else if (this.vz < 0) this.vz = 0
      } else if (down <= side) {
        this.z = b.min[2] - p.height
        if (this.vz > 0) this.knock(this.vz, -2, p.restitution)
      } else {
        const nx = dx / d, ny = dy / d
        this.x = cx + nx * p.radius; this.y = cy + ny * p.radius
        const vn = this.vx * nx + this.vy * ny
        if (vn < 0) {
          const e = p.restitution
          this.vx -= (1 + e) * vn * nx; this.vy -= (1 + e) * vn * ny
          // a knock is never quite square: a little sideways kick
          const j = p.bounceJitter * vn * this.rng.normal()
          this.vx += -ny * j; this.vy += nx * j
          this.drift[0] *= -e; this.drift[1] *= -e
          this.bump = Math.min(4, this.bump + -vn * 2)
        }
      }
    }
  }

  // A vertical knock: speed into the surface `v`, the way back out `dir`
  // (2 up, -2 down: also how hard the accelerometer feels it per m/s).
  knock(v, dir, e) {
    this.vz = Math.sign(dir) * v * e
    this.bump = Math.min(4, this.bump + v * Math.abs(dir) / 2)
  }

  // --- what the sensors see ------------------------------------------------

  // The flight controller's position estimate, in its own frame: origin and
  // heading where the estimator was last reset, x forward, y left (m).
  estimateXY() {
    const e = this.est
    const [hs, hc] = sincos(e.h0)
    const dx = this.x - e.x0, dy = this.y - e.y0
    return [hc * dx + hs * dy + e.ex, -hs * dx + hc * dy + e.ey]
  }

  resetEstimate() {
    this.est = { x0: this.x, y0: this.y, z0: 0, h0: this.heading, ex: 0, ey: 0 }
  }

  // Body-frame velocity: forward, left (m/s).
  bodyVelocity() {
    const [s, c] = sincos(this.heading)
    return [c * this.vx + s * this.vy, -s * this.vx + c * this.vy]
  }

  // Down: underside to the floor or to the top of whatever is below.
  rangeDown() {
    let top = 0
    for (const b of this.env.obstacles) {
      if (b.max[2] <= this.z + 1e-6 && b.max[2] > top && this.x >= b.min[0] && this.x <= b.max[0] && this.y >= b.min[1] && this.y <= b.max[1]) top = b.max[2]
    }
    return this.z - top
  }

  // Up: the top of the frame to the ceiling or whatever is above.
  rangeUp() {
    const z1 = this.z + this.p.height
    let low = Infinity
    for (const b of this.env.obstacles) {
      if (b.min[2] >= z1 - 1e-6 && b.min[2] < low && this.x >= b.min[0] && this.x <= b.max[0] && this.y >= b.min[1] && this.y <= b.max[1]) low = b.min[2]
    }
    return low - z1
  }

  // Front: from the front edge, straight ahead at the sensor's height.
  rangeFront() {
    const zs = this.z + this.p.height / 2
    const [s, c] = sincos(this.heading)
    const d = Environment.rayCast(this.x, this.y, c, s, this.env.obstaclesIn(zs - 0.001, zs + 0.001), 20)
    return d - 0.04
  }

  // --- the board -----------------------------------------------------------

  press(n, down) {
    if (down && !this.buttons[n]) this.pressedLatch[n] = true
    this.buttons[n] = down
  }

  // A program ended: the speaker stops; LEDs and pixels stay as they were.
  // The flight controller flies on without setpoints until its watchdog
  // stops it, as on the drone.
  programEnded() {
    this.tone = 0
  }

  snapshot() {
    return {
      id: this.id, kind: this.kind,
      x: this.x, y: this.y, z: this.z, heading: this.heading,
      roll: this.roll, pitch: this.pitch,
      propAngle: this.propAngle, motors: this.motors,
      pixels: this.pixels.map((px) => [...px]),
      leds: [...this.leds],
      buttons: [...this.buttons],
      tone: this.tone,
    }
  }
}
