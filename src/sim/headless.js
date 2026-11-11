// Run a program on a simulated device in Node, with no browser and no
// renderer: for tests, and for checking a program in the cloud.
//
//   const r = await runHeadless({ source, seconds: 10 })
//   r.output, r.error, r.trace (pose every `traceEveryMs`), r.world
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { World } from './world/world.js'
import { Environment } from './world/environment.js'
import { createDevice } from './devices.js'
import { Engine } from './runtime/engine.js'
import { KINDS as BOARDS } from './kinds.js'
import { Lockstep, LockstepAir } from './runtime/lockstep.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

let loader = null
async function loadMicroPython(opts) {
  loader ??= (await import('./runtime/mp/micropython.mjs')).loadMicroPython
  return loader({ ...opts, url: path.join(HERE, 'runtime/mp/micropython.wasm') })
}

// For a group: each VM from its own copy of the loader module, whose
// module-level state is then its own (see Engine's lockstep option).
let copies = 0
async function loadMicroPythonCopy(opts) {
  const mod = await import(new URL(`./runtime/mp/micropython.mjs?vm=${++copies}`, import.meta.url).href)
  return mod.loadMicroPython({ ...opts, url: path.join(HERE, 'runtime/mp/micropython.wasm') })
}

export async function loadEnvironment(id) {
  if (!id || id === 'empty') return Environment.empty()
  const dir = path.join(ROOT, 'public/sim-assets/env', id)
  const world = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'))
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(path.join(dir, world.floor.image)).greyscale().raw().toBuffer({ resolveWithObject: true })
  return new Environment(world, { ...world.floor, width: info.width, height: info.height, data })
}

// The Python modules: the folders under python/ that the kind lists.
export function pythonFiles(kind = 'codebot') {
  const files = {}
  for (const dir of BOARDS[kind].python) {
    const d = path.join(HERE, 'python', dir)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d, { recursive: true })) {
      if (f.endsWith('.py')) files[f.split(path.sep).join('/')] = fs.readFileSync(path.join(d, f), 'utf8')
    }
  }
  return files
}

// opts: source, kind ('codebot'), env (id or Environment), seconds (simulated
// deadline), seed, spawn {x, y, heading}, setup(world, device) before the
// run, inputs [{ t: seconds, fn(world, device) }], traceEveryMs.
export async function runHeadless(opts) {
  const run = await prepare(opts, opts.seconds)
  const t0 = performance.now()
  const result = await run.go()
  return { ...result, wallMs: performance.now() - t0 }
}

// Several devices at once, each with its own program, world and clock, on
// one timeline (runtime/lockstep.js), their radios on one air: what a class
// would see with real devices on one desk.
//   const { results } = await runHeadlessGroup({ seconds: 5, devices: [
//     { kind: 'codex', source: a }, { kind: 'codeair', source: b }] })
// Each entry takes runHeadless's options; `seconds` and `seed` are shared
// unless an entry gives its own (each world's seed is offset by its index).
export async function runHeadlessGroup(opts) {
  const lockstep = new Lockstep()
  const air = new LockstepAir(lockstep)
  const runs = []
  for (const [i, d] of opts.devices.entries()) {
    const seed = d.seed ?? (opts.seed ?? 1) + i
    const run = await prepare({ ...d, seed }, d.seconds ?? opts.seconds, lockstep)
    if (run.device.radio) air.add(run.device.radio)
    runs.push(run)
  }
  const t0 = performance.now()
  const results = await Promise.all(runs.map((r) => r.go()))
  return { results, wallMs: performance.now() - t0 }
}

async function prepare(opts, seconds = 10, lockstep = null) {
  if ((opts.kind ?? 'codebot') === 'codex' && !opts.env) opts = { ...opts, env: 'empty' }
  const env = opts.env instanceof Environment ? opts.env : await loadEnvironment(opts.env)
  const world = new World(env, { seed: opts.seed ?? 1 })
  const spawn = opts.spawn ?? env.spawns[0]
  const device = world.add(createDevice(opts.kind ?? 'codebot', env, world.rng.fork(), spawn))
  opts.setup?.(world, device)

  const trace = []
  const every = (opts.traceEveryMs ?? 50) * 1000
  const inputs = [...(opts.inputs ?? [])].sort((a, b) => a.t - b.t)
  world.onTick((w) => {
    if (w.timeUs % every === 0) trace.push({ t: w.timeUs / 1e6, ...pick(device.snapshot()) })
    while (inputs.length && inputs[0].t * 1e6 <= w.timeUs) inputs.shift().fn(w, device)
  })

  const chunks = []
  const member = lockstep?.join(world)
  const engine = new Engine({
    loadMicroPython: lockstep ? loadMicroPythonCopy : loadMicroPython, world,
    bridge: device.bridge,
    stopGraceUs: device.stopGraceUs,
    files: pythonFiles(device.kind),
    speed: Infinity,
    lockstep, member,
    onOutput: (b) => chunks.push(Buffer.from(b)),
  })
  const deadlineUs = seconds * 1e6
  world.onTick((w) => { if (w.timeUs >= deadlineUs && engine.running && !engine.stopRequested) engine.stop() })
  const go = async () => {
    const result = await engine.run(opts.source, { seed: opts.seed ?? 1 })
    if (member) lockstep.leave(member)
    return {
      ...result,
      timedOut: result.stopped && world.timeUs >= deadlineUs,
      output: Buffer.concat(chunks).toString('utf8'),
      simSeconds: world.timeUs / 1e6,
      trace, world, device,
    }
  }
  return { go, world, device }
}

function pick(s) {
  return { x: s.x, y: s.y, z: s.z, heading: s.heading, leds: s.leds, tone: s.tone, motors: s.motors }
}
