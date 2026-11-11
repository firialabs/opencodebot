// The simulator's worker: the world and MicroPython together, on simulated
// time. The page sends commands and gets frames, output and state back.
//
// in:  init { kind, env, assetsBase, seed, course }
//      course { course }   (lay a line course, world/courses.js; null takes it up)
//      room { env }        (move to another room; the course comes too)
//      run { source, seed, stepFirst } | stop | pause | resume | step | stepLine
//      speed { value } | input { what: 'button', n, down } | reset
//      stdin { text }   (keys typed at the terminal: the REPL between programs)
// out: ready { snapshot, course } | course { course } (its shape, to draw)
//      frame { snapshot } | output { bytes }
//      state { state, line } (line: main.py's, when paused) | done { result } | error { message }
import { loadMicroPython } from './mp/micropython.mjs'
import { Engine } from './engine.js'
import { World } from '../world/world.js'
import { Environment } from '../world/environment.js'
import { createDevice } from '../devices.js'
import { KINDS as BOARDS } from '../kinds.js'
import { BroadcastAir } from './broadcast-air.js'
import { layCourse, courseShape } from '../world/courses.js'

const wasmUrl = new URL('./mp/micropython.wasm', import.meta.url).href
// The Python modules: the folders under python/ that the kind lists.
const PY = import.meta.glob('../python/**/*.py', { query: '?raw', import: 'default', eager: true })
function pythonFiles(kind) {
  const dirs = BOARDS[kind].python
  const files = {}
  for (const [p, src] of Object.entries(PY)) {
    const rel = p.split('/python/')[1]           // e.g. codex/codex_drivers/funcgen.py
    const top = rel.slice(0, rel.indexOf('/'))
    if (dirs.includes(top)) files[rel.slice(top.length + 1)] = src
  }
  return files
}

let world, device, engine, env, spawn, assetsBase, course = null
// The radio's link to the other boards (CodeX and CodeAIR have a radio).
const air = new BroadcastAir(() => world?.timeUs ?? 0)
let lastFrame = 0

const post = (msg, transfer) => self.postMessage(msg, transfer ?? [])

async function loadEnv(id, base) {
  if (!id || id === 'empty') return Environment.empty()
  const dir = `${base}env/${id}/`
  const desc = await (await fetch(dir + 'world.json')).json()
  const bmp = await createImageBitmap(await (await fetch(dir + desc.floor.image)).blob())
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(bmp, 0, 0)
  const rgba = g.getImageData(0, 0, bmp.width, bmp.height).data
  const data = new Uint8Array(bmp.width * bmp.height)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]
  return new Environment(desc, { ...desc.floor, width: bmp.width, height: bmp.height, data })
}

function build(kind, seed) {
  world = new World(env, { seed })
  device = world.add(createDevice(kind, env, world.rng.fork(), spawn))
  for (const part of [device.radio, device.infrared]) if (part) air.add(part)
  engine = new Engine({
    loadMicroPython, wasmUrl, world, files: pythonFiles(kind),
    bridge: device.bridge,
    stopGraceUs: device.stopGraceUs,
    speed: engine?.speed ?? 1,
    trace: true,                  // main.py's lines, for stepping by line
    onOutput: (bytes) => post({ t: 'output', bytes }, [bytes.buffer]),
    onFrame: () => frame(true),
    onState: (state, line) => post({ t: 'state', state, line: line ?? null }),
  })
}

let screenVersion = -1
function frame(force) {
  const now = performance.now()
  if (!force && now - lastFrame < 15) return
  lastFrame = now
  device.gfx?.present()
  if (device.screen && device.screen.version !== screenVersion) {
    screenVersion = device.screen.version
    const px = device.screen.px.slice()
    post({ t: 'screen', px }, [px.buffer])
  }
  post({ t: 'frame', snapshot: world.snapshot() })
}

// While no program runs the world still turns (a robot coasting to a stop,
// buttons pressed), at real time.
let idleTimer = null
function idle(on) {
  clearInterval(idleTimer)
  if (!on) return
  let last = performance.now()
  idleTimer = setInterval(() => {
    const now = performance.now()
    // A REPL command moves the world itself, on its own clock.
    if (!engine.replBusy) world.advance(Math.round((now - last) * 1000))
    last = now
    frame(false)
  }, 16)
}

self.onmessage = async (e) => {
  const m = e.data
  try {
    switch (m.t) {
      case 'init':
        assetsBase = m.assetsBase
        env = await loadEnv(m.env, assetsBase)
        course = m.course ?? null
        spawn = layCourse(env, course) ?? env.spawns[0]
        build(m.kind, m.seed ?? 1)
        idle(true)
        post({ t: 'ready', snapshot: world.snapshot(), course: courseShape(course, env) })
        break
      case 'room':
      case 'course':
        // A new room or course puts the robot back at its start.
        if (engine.running) return
        if (m.t === 'room') env = await loadEnv(m.env, assetsBase)
        else course = m.course ?? null
        spawn = layCourse(env, course) ?? env.spawns[0]
        build(device.kind, m.seed ?? 1)
        screenVersion = -1
        post({ t: 'course', course: courseShape(course, env) })
        frame(true)
        break
      case 'run': {
        if (engine.running) return
        idle(false)
        const result = await engine.run(m.source, { seed: m.seed ?? (Math.random() * 2 ** 32) >>> 0, stepFirst: !!m.stepFirst })
        device.programEnded()         // what the device does when a program ends
        frame(true)
        idle(true)
        post({ t: 'done', result })
        break
      }
      case 'stdin':
        if (engine.running) {
          if (m.text.includes('\x03')) engine.stop()
        } else {
          await engine.replInput(m.text)
        }
        break
      case 'stop': engine.stop(); break
      case 'pause': engine.pause(); break
      case 'resume': engine.resume(); break
      case 'step': engine.step(); break
      case 'stepLine': engine.stepLine(); break
      case 'speed': engine.speed = m.value; break
      case 'input':
        if (m.what === 'button') device.press(m.n, m.down)
        if (m.what === 'tilt') { device.tiltX = m.x; device.tiltY = m.y }
        if (m.what === 'light') device.lux = m.lux
        break
      case 'reset':
        if (engine.running) return
        build(device.kind, m.seed ?? 1)
        screenVersion = -1
        frame(true)
        break
    }
  } catch (err) {
    post({ t: 'error', message: String(err?.stack || err) })
  }
}
