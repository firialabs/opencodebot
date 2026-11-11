// Simulator tests: real programs on a simulated CodeBot, headless.
//   node tests/sim.mjs
// Uses the gym when its built assets are present (they are not published
// yet), and an empty room otherwise.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { runHeadless } from '../src/sim/headless.js'
import { Engine } from '../src/sim/runtime/engine.js'
import { World } from '../src/sim/world/world.js'
import { Environment } from '../src/sim/world/environment.js'
import { createDevice } from '../src/sim/devices.js'
import { pythonFiles } from '../src/sim/headless.js'

const haveGym = fs.existsSync(new URL('../public/sim-assets/env/gym/world.json', import.meta.url))
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log('  ok  ', name) } catch (e) { failed++; console.log('  FAIL', name, '\n      ', e.message) }
}

console.log('simulator')

await test('sleep advances simulated time exactly', async () => {
  const r = await runHeadless({ source: 'import time\nt = time.monotonic()\ntime.sleep(2.5)\nprint(round(time.monotonic() - t, 3))' })
  assert.equal(r.output.trim(), '2.5')
  assert.ok(r.wallMs < 2000, `took ${r.wallMs} ms of wall time`)
})

await test('driving straight at equal power keeps the heading', async () => {
  const r = await runHeadless({
    source: 'from botcore import *\nimport time\nmotors.enable(True)\nmotors.run(LEFT, 50)\nmotors.run(RIGHT, 50)\ntime.sleep(2)',
  })
  const e = r.trace.at(-1)
  assert.ok(Math.abs(e.heading - Math.PI / 2) < 1e-9, `heading ${e.heading}`)
  assert.ok(e.y > 0.3 && e.y < 1.2, `went ${e.y} m`)
})

await test('motors do nothing until enabled', async () => {
  const r = await runHeadless({ source: 'from botcore import *\nimport time\nmotors.run(LEFT, 80)\nmotors.run(RIGHT, 80)\ntime.sleep(1)' })
  assert.ok(Math.abs(r.trace.at(-1).y) < 1e-9)
})

await test('a wall stops the robot and its encoders', async () => {
  const r = await runHeadless({
    source: `from botcore import *
import time
motors.enable(True)
motors.run(LEFT, 70)
motors.run(RIGHT, 70)
time.sleep(12)
a = [enc.read(0) for i in range(50)]
time.sleep(0.5)
b = [enc.read(0) for i in range(50)]
print(a == b or max(a) - min(a) < 1500)`,
  })
  const e = r.trace.at(-1)
  assert.ok(e.y < 2 && e.y > 1.7, `stopped at y = ${e.y}`)
})

await test('the same seed gives the same run, bit for bit', async () => {
  const source = `from botcore import *
import time, random
motors.enable(True)
for i in range(60):
    motors.run(LEFT, random.randint(-100, 100))
    motors.run(RIGHT, random.randint(-100, 100))
    s = sum(ls.check(0)) + sum(accel.read())
    time.sleep(0.05)
print(s)`
  const a = await runHeadless({ source, seed: 7 })
  const b = await runHeadless({ source, seed: 7 })
  assert.deepEqual(a.trace, b.trace)
  assert.equal(a.output, b.output)
  const c = await runHeadless({ source, seed: 8 })
  assert.notDeepEqual(a.trace.at(-1), c.trace.at(-1))
})

await test('a tight loop costs simulated time', async () => {
  const r = await runHeadless({ source: 'import time\nn = 0\nt = time.monotonic()\nwhile time.monotonic() - t < 1:\n    n += 1\nprint(n)' })
  const n = Number(r.output.trim())
  assert.ok(n > 5000 && n < 500000, `${n} iterations in a simulated second`)
})

await test('an error gives the device traceback, with the line', async () => {
  const r = await runHeadless({ source: 'print("hi")\nx = [1]\nprint(x[3])' })
  assert.equal(r.ok, false)
  assert.deepEqual(r.error, { name: 'IndexError', message: 'list index out of range', line: 3 })
  assert.match(r.output, /Traceback \(most recent call last\):\r\n  File "main.py", line 3, in <module>\r\nIndexError/)
  assert.doesNotMatch(r.output, /<stdin>/)
})

await test('a program that never ends is stopped at its deadline', async () => {
  const r = await runHeadless({ source: 'while True:\n    pass', seconds: 3 })
  assert.equal(r.stopped, true)
  assert.equal(r.timedOut, true)
})

await test('a program that swallows the stop is still stopped', async () => {
  const r = await runHeadless({ source: 'while True:\n    try:\n        while True:\n            pass\n    except:\n        pass', seconds: 1 })
  assert.equal(r.stopped, true)
})

await test('buttons and LEDs', async () => {
  const r = await runHeadless({
    source: `from botcore import *
import time
while not buttons.was_pressed(1):
    time.sleep(0.01)
leds.user(0b10100101)
leds.ls_num(2, True)
print("pressed")`,
    inputs: [{ t: 0.5, fn: (w, bot) => bot.press(1, true) }],
  })
  assert.equal(r.output.trim(), 'pressed')
  assert.equal(r.device.leds.user, 0b10100101)
  assert.equal(r.device.leds.ls, 4)
})

await test('pause holds simulated time; step and resume continue', async () => {
  const env = Environment.empty()
  const world = new World(env)
  const bot = world.add(createDevice('codebot', env, world.rng.fork(), env.spawns[0]))
  const { loadMicroPython } = await import('../src/sim/runtime/mp/micropython.mjs')
  const engine = new Engine({ loadMicroPython, world, bridge: bot.bridge, files: pythonFiles(), speed: 1 })
  const done = engine.run('import time\nwhile True:\n    time.sleep(0.01)')
  await delay(100)
  engine.pause()
  await delay(50)
  const t1 = world.timeUs
  await delay(200)
  assert.equal(world.timeUs, t1)
  engine.step()
  await delay(50)
  assert.ok(world.timeUs > t1 && world.timeUs - t1 <= 20000, `a step moved ${world.timeUs - t1} us`)
  engine.resume()
  await delay(100)
  const stopAt = performance.now()
  engine.stop()
  const r = await done
  assert.equal(r.stopped, true)
  assert.ok(performance.now() - stopAt < 50, 'stop was slow')
})

await test('proximity sees a wall ahead, and not one far away', async () => {
  const src = 'from botcore import *\nprint(prox.detect(1, 100), prox.range(8, 4))'
  const near = await runHeadless({ source: src, spawn: { x: 0, y: 1.82, heading: Math.PI / 2 } })
  const far = await runHeadless({ source: src, spawn: { x: 0, y: 0, heading: Math.PI / 2 } })
  assert.match(near.output, /^\(True, True\) \(\d+, \d+\)/)
  assert.equal(far.output.trim(), '(False, False) (-1, -1)')
})

await test('the accelerometer reads as the CB3 does, flat and still', async () => {
  const r = await runHeadless({ source: 'from botcore import *\nx, y, z = accel.read()\nprint(abs(x) < 400, abs(y) < 400, abs(z + 16384) < 400)' })
  assert.equal(r.output.trim(), 'True True True')
})

await test('the device modules are the CB3\'s own, on the CircuitPython layer', async () => {
  const r = await runHeadless({ source: 'import botcore, botservices, board, digitalio, busio\nprint(botcore.System.__name__, hasattr(botcore, \'__doc__\'))\nprint(board.I2C().scan())' })
  assert.equal(r.output.trim(), 'System False\n[14, 28]')
})

await test('the REPL runs commands on the simulated board', async () => {
  const env = Environment.empty()
  const world = new World(env)
  const bot = world.add(createDevice('codebot', env, world.rng.fork(), env.spawns[0]))
  const { loadMicroPython } = await import('../src/sim/runtime/mp/micropython.mjs')
  let out = ''
  const engine = new Engine({ loadMicroPython, world, bridge: bot.bridge, files: pythonFiles(), speed: Infinity, onOutput: (b) => (out += new TextDecoder().decode(b)) })
  await engine.replInput('from botcore import *\r')
  await engine.replInput('leds.user(5); print(6 * 7)\r')
  await delay(50)
  assert.match(out, />>> /)
  assert.match(out, /42/)
  assert.equal(bot.leds.user, 5)
  // a command that loops forever, then Ctrl-C
  await engine.replInput('while True:\r    pass\r\r')
  await delay(50)
  await engine.replInput('\x03')
  await delay(100)
  assert.match(out, /KeyboardInterrupt/)
  assert.equal(engine.replBusy, false)
})

if (haveGym) {
  await test('gym: the line sensors see the court lines', async () => {
    const r = await runHeadless({
      env: 'gym', spawn: { x: 0.3, y: 0, heading: Math.PI / 2 },
      source: `from botcore import *
import time
motors.enable(True)
motors.run(LEFT, 60)
motors.run(RIGHT, 60)
seen = 0
for i in range(400):
    if ls.check(1500, True)[2]:
        seen += 1
    time.sleep(0.01)
print(seen)`,
    })
    assert.ok(Number(r.output) > 3, `saw a line ${r.output.trim()} times`)
  })
} else {
  console.log('  skip  gym tests (no built gym: node sim/tools/build-env.mjs gym)')
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

if (failed) { console.log(`${failed} failed`); process.exit(1) }
process.exit(0)
