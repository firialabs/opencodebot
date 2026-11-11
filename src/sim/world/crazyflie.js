// CodeAIR's flight controller, simulated at its link: a Crazyflie that
// speaks CRTP. On the drone an STM32 runs Bitcraze's Crazyflie firmware and
// the ESP32's Python reaches it only through the C module `crtp` (send,
// receive, the log queue, the console). So the device's own flight, flightdb
// and cflib modules run unchanged against this, and what they send is
// decoded here as the firmware decodes it:
//
//   port 2   parameters: TOC, read (ch 1), write (ch 2), write by name (ch 3)
//   port 3   the legacy commander: roll, pitch, yaw rate, thrust
//   port 5   logging: TOC, log blocks (ch 1), log data out (ch 2)
//   port 7   the generic commander: stop, velocity, z-distance, hover,
//            position setpoints (ch 0); notify-setpoint-stop (ch 1)
//   port 8   the high-level commander: take-off, land, go-to, stop
//   port 13  platform: the firmware version
//   port 15  link: echo and source
//
// Its tables of contents are the ones the device carries (flight_catalog.py,
// handed over by the bridge), so the catalog and the firmware always agree,
// as they do on a drone whose catalog CRCs match.
//
// The flight itself is the airframe's (codeair.js): this decides which
// setpoint holds, with the firmware's watchdog (stale after 500 ms: level
// and hold height; after 2 s: motors off).
import { wrapAngle, sincos } from './fmath.js'

const DEG = Math.PI / 180
const LOG_TYPES = { 1: ['Uint8', 1], 2: ['Uint16', 2], 3: ['Uint32', 4], 4: ['Int8', 1], 5: ['Int16', 2], 6: ['Int32', 4], 7: ['Float32', 4], 8: ['Float16', 2] }
const PARAM_TYPES = ['Int8', 'Int16', 'Int32', 'BigInt64', null, 'Float16', 'Float32', 'Float64', 'Uint8', 'Uint16', 'Uint32', 'BigUint64']
const PARAM_SIZE = [1, 2, 4, 8, 0, 2, 4, 8, 1, 2, 4, 8]
const OUT_OF_RANGE_MM = 32767        // what a ranger reports with nothing in range (to check on a CodeAIR)
const RANGE_MAX = 4.0                // m, the VL53L1x's reach
const QUEUE_MAX = 64                 // packets the C module buffers
// Log packets it keeps, oldest dropped. flight.get_data() reads the oldest,
// so this is how stale a reading can be (to check on a CodeAIR).
const LOG_QUEUE_MAX = 2
// Its last word is what stm_fw.version() names, so selftest.check_firmware
// finds it up to date (python/codeair/stm_fw.py).
const VERSION = 'CodeAIR Crazyflie 2024.10-codeair-sim'

export class Crazyflie {
  constructor(air) {
    this.air = air
    this.logToc = []
    this.paramToc = []
    this.logCrc = 0
    this.paramCrc = 0
    this.reset()
  }

  // The flight controller restarts (power on, or its reset line).
  reset() {
    this.rx = []                 // [port, ch, Uint8Array] for crtp.receive()
    this.logq = []               // [block, ms, Uint8Array] for crtp.log_read()
    this.console = ''
    this.blocks = new Map()      // id -> { items: [[type, id]], periodMs, nextMs, running }
    this.params = new Map()      // id -> value
    this.setpoint = null         // { mode, ..., tUs }
    this.hl = null               // a high-level plan
    this.ms = 0
    this.linked = true
    this._writeConsole('SYS: ----\nSYS: Crazyflie 2.1 is up and running!\nSYS: CodeAIR flight controller (simulated)\n')
  }

  // The device's catalog, the Python source of flight_catalog.py.
  loadCatalog(src) {
    if (this.logToc.length) return
    const toc = (name) => JSON.parse(new RegExp(`${name}_toc = '(.*)'`).exec(src)[1])
    const crc = (name) => Number(new RegExp(`${name}_crc = (0x[0-9A-Fa-f]+)`).exec(src)[1])
    this.logToc = toc('log'); this.logCrc = crc('log')
    this.paramToc = toc('param'); this.paramCrc = crc('param')
    this.paramIds = new Map(this.paramToc.map(([id, , g, n]) => [`${g}.${n}`, id]))
    this.logNames = this.logToc.map(([, , g, n]) => `${g}.${n}`)
  }

  _writeConsole(text) {
    this.console = (this.console + text).slice(-1024)
    this.onConsole?.(text)
  }

  _reply(port, ch, bytes) {
    this.rx.push([port, ch, Uint8Array.from(bytes)])
    if (this.rx.length > QUEUE_MAX) this.rx.shift()
  }

  // --- from the ESP32 -----------------------------------------------------

  send(port, ch, d) {
    if (!this.linked) return
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    switch (port) {
      case 2: return this._param(ch, d, v)
      case 3: return this._legacy(v)
      case 5: return this._log(ch, d, v)
      case 7: return this._generic(ch, d, v)
      case 8: return this._highLevel(d, v)
      case 13:
        if (ch === 1 && d[0] === 2) this._reply(13, 1, [2, ...new TextEncoder().encode(VERSION)])
        return
      case 15:
        if (ch === 0) this._reply(15, 0, d)
        if (ch === 1) this._reply(15, 1, [...new TextEncoder().encode('Bitcraze Crazyflie'), ...new Array(12).fill(0)])
        return
    }
  }

  _toc(port, d) {
    const toc = port === 5 ? this.logToc : this.paramToc
    const crc = port === 5 ? this.logCrc : this.paramCrc
    if (d[0] === 3) {          // GET_INFO_V2: count, CRC (and for logs, block and op limits)
      const b = new DataView(new ArrayBuffer(7))
      b.setUint8(0, 3); b.setUint16(1, toc.length, true); b.setUint32(3, crc, true)
      this._reply(port, 0, [...new Uint8Array(b.buffer), ...(port === 5 ? [16, 128] : [])])
    } else if (d[0] === 2) {   // GET_ITEM_V2
      const id = d[1] | (d[2] << 8)
      const it = toc[id]
      if (!it) return this._reply(port, 0, [2, d[1], d[2]])
      const enc = new TextEncoder()
      this._reply(port, 0, [2, d[1], d[2], it[1], ...enc.encode(it[2]), 0, ...enc.encode(it[3]), 0])
    }
  }

  // --- parameters ---------------------------------------------------------

  _param(ch, d, v) {
    if (ch === 0) return this._toc(2, d)
    if (ch === 1) {            // read: [id16] -> [id16, status, value]
      const id = v.getUint16(0, true)
      const t = this.paramToc[id]?.[1]
      if (t === undefined) return this._reply(2, 1, [d[0], d[1], 1])
      this._reply(2, 1, [d[0], d[1], 0, ...encode(PARAM_TYPES[t], PARAM_SIZE[t], this.params.get(id) ?? 0)])
    } else if (ch === 2) {     // write: [id16, value] -> echoed
      const id = v.getUint16(0, true)
      const t = this.paramToc[id]?.[1]
      if (t === undefined) return
      const value = decode(PARAM_TYPES[t], v, 2)
      this._setParam(id, value)
      this._reply(2, 2, d)
    } else if (ch === 3) {     // write by name: [0, group\0name\0, type, value]
      let i = 1
      const str = () => { let s = ''; while (i < d.length && d[i]) s += String.fromCharCode(d[i++]); i++; return s }
      const name = `${str()}.${str()}`
      const id = this.paramIds.get(name)
      const t = this.paramToc[id]?.[1]
      if (t === undefined) return
      this._setParam(id, decode(PARAM_TYPES[t], v, i + 1))
    }
  }

  _setParam(id, value) {
    this.params.set(id, value)
    const name = `${this.paramToc[id][2]}.${this.paramToc[id][3]}`
    if (name === 'kalman.resetEstimation' && value) this.air.resetEstimate()
  }

  paramValue(name) {
    return this.params.get(this.paramIds?.get(name)) ?? 0
  }

  // --- logging --------------------------------------------------------------

  _log(ch, d, v) {
    if (ch === 0) return this._toc(5, d)
    if (ch !== 1) return
    const cmd = d[0], id = d[1]
    const ack = (err) => this._reply(5, 1, [cmd, id, err])
    const items = () => {
      const out = []
      for (let i = 2; i + 2 < d.length; i += 3) out.push([d[i] & 0x0f, d[i + 1] | (d[i + 2] << 8)])
      return out
    }
    switch (cmd) {
      case 6:                  // create a block
        if (this.blocks.has(id)) return ack(17)                    // EEXIST
        if (this.blocks.size >= 16) return ack(12)                 // ENOMEM
        this.blocks.set(id, { items: items(), periodMs: 100, nextMs: 0, running: false })
        return ack(0)
      case 7: {                // append to a block
        const b = this.blocks.get(id)
        if (!b) return ack(2)                                      // ENOENT
        b.items.push(...items())
        return ack(0)
      }
      case 8: {                // start: period in ms
        const b = this.blocks.get(id)
        if (!b) return ack(2)
        b.periodMs = Math.max(10, v.getUint16(2, true))
        b.nextMs = this.ms
        b.running = true
        return ack(0)
      }
      case 4: {                // stop
        const b = this.blocks.get(id)
        if (!b) return ack(2)
        b.running = false
        return ack(0)
      }
      case 5:                  // reset: every block gone
        this.blocks.clear()
        this.logq = []
        return ack(0)
    }
  }

  _logPacket(id, b) {
    const parts = []
    for (const [type, item] of b.items) {
      const [kind, size] = LOG_TYPES[type] ?? ['Uint8', 1]
      parts.push(...encode(kind, size, this.logValue(this.logNames[item])))
    }
    this.logq.push([id, this.ms & 0xffffff, Uint8Array.from(parts)])
    if (this.logq.length > LOG_QUEUE_MAX) this.logq.shift()
  }

  // A log variable's value now, by its TOC name.
  logValue(name) {
    const a = this.air
    const p = a.p
    const rng = a.rng
    const [fwd, left] = a.bodyVelocity()
    const deg = (r) => r / DEG
    const mm = (m) => (m >= 0 && m <= RANGE_MAX ? Math.round(m * 1000) : OUT_OF_RANGE_MM)
    const [s, c] = sincos(a.heading)
    // specific force in g, body frame: what an accelerometer reads
    const above = a.rangeDown()                // over whatever is below it
    const fall = !a.motors && above > 0.001
    const accFwd = fall ? 0 : (c * a.ax + s * a.ay) / p.gravity
    const accLeft = fall ? 0 : (-s * a.ax + c * a.ay) / p.gravity
    const accUp = fall ? 0 : 1 + a.az / p.gravity
    const n = (sd) => sd * rng.normal()
    const est = a.estimateXY()
    const [hs, hc] = sincos(a.est.h0)
    const height = Math.max(0.02, above)
    const flow = 4.8 * 0.01 / height           // pixels per (m/s) in one 10 ms frame of the PMW3901
    const asl = 270 + a.z + n(0.05)
    switch (name) {
      case 'stateEstimate.x': return est[0]
      case 'stateEstimate.y': return est[1]
      case 'stateEstimate.z': return a.estimateZ()
      case 'stateEstimate.vx': return hc * a.vx + hs * a.vy
      case 'stateEstimate.vy': return -hs * a.vx + hc * a.vy
      case 'stateEstimate.vz': return a.vz
      case 'stateEstimate.ax': return accFwd
      case 'stateEstimate.ay': return accLeft
      case 'stateEstimate.az': return accUp - 1
      case 'stateEstimate.roll': case 'stabilizer.roll': return deg(a.roll)
      case 'stateEstimate.pitch': return deg(-a.pitch)
      case 'stabilizer.pitch': return deg(a.pitch)
      case 'stateEstimate.yaw': case 'stabilizer.yaw': return deg(wrapAngle(a.heading - a.est.h0))
      case 'stabilizer.thrust': return a.motors ? 36000 + 4000 * a.vz : 0
      case 'range.front': return mm(a.rangeFront() + n(0.003))
      case 'range.up': return mm(a.rangeUp() + n(0.003))
      case 'range.zrange': return mm(a.rangeDown() + 0.01 + n(0.002))
      case 'range.back': case 'range.left': case 'range.right': return OUT_OF_RANGE_MM
      case 'motion.deltaX': return Math.round(-left * flow * 100 + n(0.6))
      case 'motion.deltaY': return Math.round(-fwd * flow * 100 + n(0.6))
      case 'motion.squal': return above > 0.05 ? 90 + Math.round(n(5)) : 20
      case 'motion.motion': return 1
      case 'acc.x': return accFwd + n(0.01) + a.bump * rng.normal()
      case 'acc.y': return accLeft + n(0.01) + a.bump * rng.normal()
      case 'acc.z': return accUp + n(0.01) + a.bump * rng.normal()
      case 'gyro.x': return deg(a.rollRate) + n(0.2)
      case 'gyro.y': return deg(a.pitchRate) + n(0.2)
      case 'gyro.z': return deg(a.yawRate) + n(0.2)
      case 'gyro.xRaw': return Math.round(16.4 * (deg(a.rollRate) + n(0.2)))
      case 'gyro.yRaw': return Math.round(16.4 * (deg(a.pitchRate) + n(0.2)))
      case 'gyro.zRaw': return Math.round(16.4 * (deg(a.yawRate) + n(0.2)))
      // the Earth's field, about 0.2 G north and 0.45 G down, in the body frame
      case 'mag.x': return 0.2 * s + n(0.003)
      case 'mag.y': return 0.2 * c + n(0.003)
      case 'mag.z': return -0.45 + n(0.003)
      case 'baro.asl': return asl
      case 'baro.temp': return 24 + n(0.05)
      case 'baro.pressure': return 1013.25 - 0.12 * asl
      case 'pm.vbat': return a.volts
      case 'pm.vbatMV': return Math.round(a.volts * 1000)
      case 'pm.batteryLevel': return 80
      case 'pm.state': return 0
      // The supervisor's bits: can arm, auto-arm and can fly always (it never
      // tumbles or locks here); armed with the motors on; flying once off the floor.
      case 'supervisor.info': return 0x01 | 0x04 | 0x08 | (a.motors ? 0x02 : 0) | (a.motors && above > 0.02 ? 0x10 : 0)
      case 'sys.canfly': return 1
      case 'sys.isFlying': return a.motors && above > 0.02 ? 1 : 0
      case 'sys.isTumbled': return 0
      case 'motor.m1': case 'motor.m2': case 'motor.m3': case 'motor.m4':
        return a.motors ? Math.round(36000 + 4000 * a.vz) : 0
      default: return 0
    }
  }

  // --- setpoints --------------------------------------------------------------

  _generic(ch, d, v) {
    if (ch === 1) return                  // notify-setpoint-stop: nothing to hand over to
    const t = this.air.tUs
    const f = (i) => v.getFloat32(1 + 4 * i, true)
    this.hl = null
    switch (d[0]) {
      case 0: this.setpoint = { mode: 'stop', tUs: t }; break
      case 1: this.setpoint = { mode: 'velocity', world: true, vx: f(0), vy: f(1), vz: f(2), yawRate: -f(3) * DEG, tUs: t }; break
      case 2: this.setpoint = { mode: 'tilt', roll: f(0) * DEG, pitch: f(1) * DEG, yawRate: -f(2) * DEG, z: f(3), tUs: t }; break
      case 5: this.setpoint = { mode: 'hover', vx: f(0), vy: f(1), yawRate: -f(2) * DEG, z: f(3), tUs: t }; break
      case 7: this.setpoint = { mode: 'position', x: f(0), y: f(1), z: f(2), yaw: f(3) * DEG, tUs: t }; break
    }
  }

  _legacy(v) {
    if (v.byteLength < 14) return
    const thrust = v.getUint16(12, true)
    const t = this.air.tUs
    this.hl = null
    if (thrust === 0) { this.setpoint = { mode: 'stop', tUs: t }; return }
    // thrust about 36000 holds height; more climbs, less sinks
    this.setpoint = {
      mode: 'tilt', roll: v.getFloat32(0, true) * DEG, pitch: -v.getFloat32(4, true) * DEG,
      yawRate: -v.getFloat32(8, true) * DEG, climb: (thrust - 36000) / 20000, tUs: t,
    }
  }

  _highLevel(d, v) {
    const a = this.air
    const [ex, ey] = a.estimateXY()
    const here = { x: ex, y: ey, z: a.estimateZ(), yaw: wrapAngle(a.heading - a.est.h0) }
    const plan = (to, dur, landing) => {
      this.hl = { from: here, to, t0: a.tUs, dur: Math.max(0.1, dur) * 1e6, landing }
      this.setpoint = null
    }
    switch (d[0]) {
      case 7: case 8: {        // take off, land: group, height, yaw, use current yaw, duration
        const h = v.getFloat32(2, true), yaw = v.getFloat32(6, true), cur = d[10], dur = v.getFloat32(11, true)
        plan({ x: here.x, y: here.y, z: h, yaw: cur ? here.yaw : yaw }, dur, d[0] === 8)
        break
      }
      case 4: {                // go to: group, relative, x, y, z, yaw, duration
        const rel = d[2]
        const x = v.getFloat32(3, true), y = v.getFloat32(7, true), z = v.getFloat32(11, true)
        const yaw = v.getFloat32(15, true), dur = v.getFloat32(19, true)
        plan(rel ? { x: here.x + x, y: here.y + y, z: here.z + z, yaw: here.yaw + yaw } : { x, y, z, yaw }, dur, false)
        break
      }
      case 3: this.hl = null; this.setpoint = { mode: 'stop', tUs: a.tUs }; break
    }
  }

  // The setpoint that holds now, or null for motors off.
  setpointNow(tUs) {
    if (this.hl) {
      const h = this.hl
      let f = Math.min(1, (tUs - h.t0) / h.dur)
      if (f >= 1 && h.landing && this.air.rangeDown() < 0.03) { this.hl = null; return null }
      f = f * f * (3 - 2 * f)
      const L = (k) => h.from[k] + (h.to[k] - h.from[k]) * f
      return { mode: 'position', x: L('x'), y: L('y'), z: L('z'), yaw: L('yaw') }
    }
    const sp = this.setpoint
    if (!sp || sp.mode === 'stop') return null
    const age = (tUs - sp.tUs) / 1e6
    if (age > this.air.p.shutdownS) return null
    if (age > this.air.p.stabilizeS) return { mode: 'level', z: sp.z }
    return sp
  }

  // --- time ----------------------------------------------------------------------

  step(dt) {
    this.ms += dt * 1000
    for (const [id, b] of this.blocks) {
      if (b.running && this.ms >= b.nextMs) {
        b.nextMs += b.periodMs
        this._logPacket(id, b)
      }
    }
  }
}

function encode(kind, size, value) {
  const b = new DataView(new ArrayBuffer(size))
  if (kind === 'Float16') b.setUint16(0, toHalf(Number(value)), true)
  else if (kind.startsWith('Big')) b[`set${kind}`](0, BigInt(Math.round(Number(value))), true)
  else if (kind.startsWith('Float')) b[`set${kind}`](0, Number(value), true)
  else b[`set${kind}`](0, Math.round(Number(value)), true)
  return [...new Uint8Array(b.buffer)]
}

function decode(kind, v, at) {
  if (!kind) return 0
  if (kind === 'Float16') return fromHalf(v.getUint16(at, true))
  if (kind.startsWith('Big')) return Number(v[`get${kind}`](at, true))
  return v[`get${kind}`](at, true)
}

function toHalf(f) {
  const b = new DataView(new ArrayBuffer(4))
  b.setFloat32(0, f)
  const x = b.getUint32(0)
  const sign = (x >>> 16) & 0x8000
  const e = ((x >>> 23) & 0xff) - 112
  if (e <= 0) return sign
  if (e >= 31) return sign | 0x7c00
  return sign | (e << 10) | ((x >>> 13) & 0x3ff)
}

function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff
  if (e === 0) return s * m * 2 ** -24
  if (e === 31) return m ? NaN : s * Infinity
  return s * (1 + m / 1024) * 2 ** (e - 15)
}
