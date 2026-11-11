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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

let loader = null
async function loadMicroPython(opts) {
  loader ??= (await import('./runtime/mp/micropython.mjs')).loadMicroPython
  return loader({ ...opts, url: path.join(HERE, 'runtime/mp/micropython.wasm') })
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
  const env = opts.env instanceof Environment ? opts.env : await loadEnvironment(opts.env)
  const world = new World(env, { seed: opts.seed ?? 1 })
  const spawn = opts.spawn ?? env.spawns[0]
  if ((opts.kind ?? 'codebot') === 'codex' && !opts.env) opts.env = 'empty'
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
  const engine = new Engine({
    loadMicroPython, world,
    bridge: device.bridge,
    stopGraceUs: device.stopGraceUs,
    files: pythonFiles(device.kind),
    speed: Infinity,
    onOutput: (b) => chunks.push(Buffer.from(b)),
  })
  const deadlineUs = (opts.seconds ?? 10) * 1e6
  world.onTick((w) => { if (w.timeUs >= deadlineUs && engine.running && !engine.stopRequested) engine.stop() })
  const t0 = performance.now()
  const result = await engine.run(opts.source, { seed: opts.seed ?? 1 })
  return {
    ...result,
    timedOut: result.stopped && world.timeUs >= deadlineUs,
    output: Buffer.concat(chunks).toString('utf8'),
    simSeconds: world.timeUs / 1e6,
    wallMs: performance.now() - t0,
    trace, world, device,
  }
}

function pick(s) {
  return { x: s.x, y: s.y, z: s.z, heading: s.heading, leds: s.leds, tone: s.tone, motors: s.motors }
}
