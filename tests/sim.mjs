// Simulator tests: real programs on a simulated CodeBot, headless.
//   node tests/sim.mjs
// Uses the gym when its built assets are present (they are not published
// yet), and an empty room otherwise.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { runHeadless, runHeadlessGroup } from '../src/sim/headless.js'
import { REMOTE_CODEX, LISTENER_CODEX, LISTENER_CODEAIR, REMOTE_FOR_CODEAIR, XFLY_CODEAIR } from '../src/sim/boards/examples.js'
import { COURSES } from '../src/sim/world/courses.js'
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

await test('step by line: each step stops at the next line of main.py, through its functions, not botcore\'s', async () => {
  const env = Environment.empty()
  const world = new World(env)
  const bot = world.add(createDevice('codebot', env, world.rng.fork(), env.spawns[0]))
  const { loadMicroPython } = await import('../src/sim/runtime/mp/micropython.mjs')
  const paused = []
  const engine = new Engine({
    loadMicroPython, world, bridge: bot.bridge, files: pythonFiles(), speed: 1, trace: true,
    onState: (s, line) => { if (s === 'paused') paused.push(line) },
  })
  const src = [
    'from botcore import *',       // 1
    'def blink(n):',               // 2
    '    leds.user(n)',            // 3
    '    return n + 1',            // 4
    'x = 0',                       // 5
    'while True:',                 // 6
    '    x = blink(x) % 200',      // 7
  ].join('\n')
  const done = engine.run(src, { stepFirst: true })
  for (let i = 0; i < 9; i++) {
    const n = paused.length
    for (let w = 0; paused.length === n && w < 400; w++) await delay(5)
    engine.stepLine()
  }
  await delay(50)
  engine.resume()
  const t = world.timeUs
  await delay(100)
  engine.pause()
  await delay(50)
  assert.ok(world.timeUs > t, 'resume after stepping runs on')
  engine.stop()
  await done
  // (`while True:` has no code of its own; each turn of the loop is line 7 again)
  assert.deepEqual(paused.slice(0, 9), [1, 2, 5, 7, 3, 4, 7, 3, 4])
})

await test('tracing main.py costs no simulated time', async () => {
  const src = 'import time\nt = time.ticks_us()\nn = 0\nfor i in range(2000):\n    n += i\nprint(time.ticks_us() - t)'
  const a = await runHeadless({ source: src, env: 'empty' })
  const b = await runHeadless({ source: src, env: 'empty', trace: true })
  assert.equal(b.output, a.output)
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

console.log('line courses')

// A follower as a student builds it from the blocks.
const FOLLOW = `from botcore import *
motors.enable(True)
while True:
    s = ls.check()
    if s[2] or (s[1] and s[3]):
        motors.run(LEFT, 40)
        motors.run(RIGHT, 40)
    elif s[1] or s[0]:
        motors.run(LEFT, 10)
        motors.run(RIGHT, 45)
    elif s[3] or s[4]:
        motors.run(LEFT, 45)
        motors.run(RIGHT, 10)
    else:
        motors.run(LEFT, 30)
        motors.run(RIGHT, 30)
`
// The share of a run the line sensors' middle spends off the tape.
function offTape(r) {
  const floor = r.world.env.floor
  const off = r.trace.filter((p) => floor.reflectance(p.x + 0.116 * Math.cos(p.heading), p.y + 0.116 * Math.sin(p.heading), 0.03) > 0.6)
  return off.length / r.trace.length
}
for (const course of ['oval', 'eight', 'gap']) {
  await test(`a follower goes round the ${COURSES[course].name.toLowerCase()} and keeps to it`, async () => {
    const r = await runHeadless({ source: FOLLOW, course, env: haveGym ? 'gym' : 'empty', seconds: 20, traceEveryMs: 100 })
    assert.ok(!r.error, r.output)
    const dist = r.trace.reduce((a, p, i) => (i ? a + Math.hypot(p.x - r.trace[i - 1].x, p.y - r.trace[i - 1].y) : 0), 0)
    assert.ok(dist > 4, `went ${dist.toFixed(1)} m`)
    assert.ok(offTape(r) < 0.03, `off the tape ${(offTape(r) * 100).toFixed(0)}% of the time`)
  })
}

await test('on the T it starts on the stem (a 19 mm tape under three sensors), and the crossbar reads on all five', async () => {
  const r = await runHeadless({
    course: 'tee', env: 'empty', seconds: 15,
    source: `from botcore import *\nimport time\nprint(ls.check())\nmotors.enable(True)\nmotors.run(LEFT, 50)\nmotors.run(RIGHT, 50)\nwhile not all(ls.check()):\n    time.sleep(0.005)\nmotors.enable(False)\nprint('bar')`,
  })
  assert.equal(r.error, undefined, r.output)
  const [first, last] = r.output.trim().split('\n')
  assert.equal(first, '(False, True, True, True, False)')
  assert.equal(last, 'bar')
  assert.ok(Math.abs(r.device.y + 0.116 - 0.5) < 0.03, `stopped with its sensors at y ${(r.device.y + 0.116).toFixed(3)}`)
})

console.log('CodeAIR')

const air = (source, opts = {}) => runHeadless({ kind: 'codeair', env: 'empty', seconds: 40, traceEveryMs: 20, ...opts, source })
const PRE = 'from codeair import *\nfrom flight import *\nimport time\n'

await test('take off, hold, and land, with its own motion commander', async () => {
  let top = 0
  const r = await air(PRE + 'fly.take_off(0.5)\nfly.steady(2)\nprint(round(get_data(RANGERS)[2] / 1000, 1))\nfly.land()\nfly.steady(1)', {
    setup: (w, d) => w.onTick(() => { if (w.timeUs > 6e6 && w.timeUs < 7e6) top = Math.max(top, d.z) }),
  })
  assert.equal(r.error, undefined, r.output)
  assert.equal(r.output.trim(), '0.5')
  assert.ok(Math.abs(top - 0.5) < 0.04, `held at ${top} m`)
  assert.ok(r.device.z < 0.001 && !r.device.motors, `ended at ${r.device.z} m, motors ${r.device.motors}`)
  // it waited for the estimator reset (2.1 s) before it left the floor
  assert.ok(r.trace.find((s) => s.z > 0.01).t > 2.1)
})

await test('forward and turn go about as far as asked, with some drift', async () => {
  const r = await air(PRE + 'fly.take_off(0.4)\nfly.forward(1.0)\nfly.turn_left(90)\nfly.land()')
  const end = r.trace.at(-1)
  // spawned at the centre facing +y
  assert.ok(Math.abs(end.y - 1.0) < 0.25 && Math.abs(end.x) < 0.25, `ended at ${end.x}, ${end.y}`)
  // turn_left(90) polls for round(12.5) = 12 tenths of a second: 86.4 degrees on the drone
  const turned = ((end.heading - Math.PI / 2) * 180) / Math.PI
  assert.ok(Math.abs(turned - 86.4) < 8, `turned ${turned} degrees`)
})

await test('the same seed flies the same path, bit for bit', async () => {
  const src = PRE + 'fly.take_off(0.4)\nfly.forward(0.5)\nfly.circle_left(0.3)\nfly.land()'
  const [a, b] = [await air(src), await air(src)]
  assert.deepEqual(a.trace.map((s) => [s.x, s.y, s.z]), b.trace.map((s) => [s.x, s.y, s.z]))
  const c = await air(src, { seed: 2 })
  assert.notDeepEqual(a.trace.map((s) => s.x), c.trace.map((s) => s.x))
})

await test('with no setpoints for 2 s the flight controller stops the motors, and it falls', async () => {
  const r = await air(PRE + 'fly.take_off(0.8)\ntime.sleep(3)\nprint(fly.is_flying())')
  const t0 = r.trace.find((s) => s.z > 0.75).t
  const fell = r.trace.find((s) => s.t > t0 && !s.motors && s.z > 0.5)
  assert.ok(fell, 'the motors never stopped in the air')
  assert.ok(r.device.z < 0.001, `still at ${r.device.z} m`)
  assert.equal(r.output.trim(), 'True')          // the program does not know
})

await test('a stop inside `with recorder:` lands it, as on the drone', async () => {
  const r = await air(PRE + 'with recorder:\n    fly.take_off(0.6)\n    while True:\n        fly.steady(1)', { seconds: 8 })
  assert.equal(r.stopped, true)
  assert.ok(r.simSeconds > 9, `ended at ${r.simSeconds} s`)
  // land() stops the motors a few centimetres up, still sinking
  assert.ok(r.device.z < 0.08 && r.device.cf.setpoint.mode === 'stop', `at ${r.device.z} m, ${r.device.cf.setpoint.mode}`)
  // it came down under control, not falling: never faster than 0.5 m/s
  let fastest = 0
  for (let i = 1; i < r.trace.length; i++) fastest = Math.max(fastest, (r.trace[i - 1].z - r.trace[i].z) / 0.02)
  assert.ok(fastest < 0.5, `fell at ${fastest} m/s`)
  assert.equal(r.device.pixels[0][0] > 0 && r.device.pixels[0][1] === 0, true)   // the recorder's red
})

await test('a wall stops it, and the rangers see the room', async () => {
  // the empty room's north wall is 2 m ahead
  const r = await air(PRE + 'fly.take_off(0.5)\nfly.steady(0.5)\nprint(get_data(RANGERS))\nfly.forward(3, 0.5)\nprint(get_data(RANGERS)[0])\nfly.land()')
  const [first, second] = r.output.trim().split('\n')
  const [front, up, down] = first.replace(/[()]/g, '').split(',').map(Number)
  assert.ok(Math.abs(front - 1960) < 120, `front ${front}`)
  assert.equal(up, 32767)                        // nothing above in reach
  assert.ok(Math.abs(down - 510) < 30, `down ${down}`)
  assert.ok(Number(second) < 60, `front at the wall ${second}`)
  const far = Math.max(...r.trace.map((s) => s.y))
  assert.ok(far < 2 - 0.06 && far > 1.85, `got to ${far}`)
})

await test('its board: LEDs, NeoPixels, buttons, speaker, battery, parameters', async () => {
  let tone = 0
  const r = await air(PRE + `leds.set(0, 200)
leds.set_status(9)
pixels.set(TOP_FRONT_LEFT, RED, 100)
print(leds.get(0), leds.get_status(), pixels.get(TOP_FRONT_LEFT))
speaker.beep(880, 100)
while not buttons.was_pressed(BTN_1):
    time.sleep(0.01)
print(buttons.is_pressed(), round(power.battery_voltage(5), 1), power.is_usb())
set_param('motorPowerSet.m1', 1234)
print(get_param('motorPowerSet.m1'), version())`, {
    inputs: [{ t: 1, fn: (w, d) => d.press(1, true) }],
    setup: (w, d) => w.onTick(() => { tone = Math.max(tone, d.tone) }),
  })
  assert.equal(r.error, undefined, r.output)
  const lines = r.output.trim().split('\n')
  assert.equal(lines[0], '200 9 (255, 0, 0)')
  assert.equal(lines[1], '(False, True) 3.9 False')
  assert.match(lines[2], /^1234 CodeAIR/)
  assert.equal(r.device.leds[7], 200)            // LED 0 is the driver's output 7
  assert.equal(tone, 880)
  assert.equal(r.device.tone, 0)
})

console.log('radio')

const PING = `import radio, time
radio.on()
radio.config(channel=5)
for i in range(3):
    radio.send('ping %d' % i)
    while True:
        heard = radio.receive_full()
        if heard:
            print(heard)
            break
        time.sleep(0.01)
`
const PONG = `import radio, time
radio.on()
radio.config(channel=5)
n = 0
while n < 3:
    m = radio.receive()
    if m:
        radio.send(m.replace('ping', 'pong'))
        n += 1
    time.sleep(0.005)
print('done', time.ticks_ms())
`

await test('a CodeX and a CodeAIR talk, the same way every time', async () => {
  const run = () => runHeadlessGroup({ seconds: 5, devices: [{ kind: 'codex', source: PING }, { kind: 'codeair', source: PONG }] })
  const a = await run()
  const [x, air] = a.results
  assert.equal(x.error, undefined, x.output)
  assert.equal(air.error, undefined, air.output)
  assert.ok(x.ok && air.ok, 'both programs end on their own')
  const lines = x.output.trim().split('\n')
  assert.deepEqual(lines.map((l) => /'(pong \d)'/.exec(l)?.[1]), ['pong 0', 'pong 1', 'pong 2'])
  const rssi = Number(/, (-\d+),/.exec(lines[0])[1])
  assert.ok(rssi < -30 && rssi > -60, `rssi ${rssi}`)
  const b = await run()
  assert.equal(b.results[0].output, x.output)
  assert.equal(b.results[1].output, air.output)
})

await test('only the same channel, only while on, and never itself', async () => {
  const listen = (setup) => `import radio, time\nradio.on()\n${setup}\ntime.sleep(0.5)\nn = 0\nwhile radio.receive():\n    n += 1\nprint(n)\n`
  const { results } = await runHeadlessGroup({ seconds: 2, devices: [
    { kind: 'codex', source: 'import radio, time\nradio.on()\nradio.config(channel=7)\nfor i in range(4):\n    radio.send(i)\n    time.sleep(0.05)\ntime.sleep(0.3)\nprint(radio.receive())' },
    { kind: 'codex', source: listen('radio.config(channel=7)') },
    { kind: 'codex', source: listen('radio.config(channel=3)') },
    { kind: 'codeair', source: listen('radio.config(channel=7)\nradio.off()\ntime.sleep(0.1)\nradio.on()') },
  ] })
  assert.deepEqual(results.map((r) => r.output.trim()), ['None', '4', '0', '2'])
})

await test('the boards page examples: a CodeX remote lights the listeners', async () => {
  const press = (n, t) => [{ t, fn: (w, d) => d.press(n, true) }, { t: t + 0.2, fn: (w, d) => d.press(n, false) }]
  let greenAt1
  const { results } = await runHeadlessGroup({ seconds: 2, devices: [
    { kind: 'codex', source: REMOTE_CODEX, inputs: [...press(4, 0.5), ...press(5, 1.2)] },
    { kind: 'codex', source: LISTENER_CODEX, inputs: [{ t: 1, fn: (w, d) => { greenAt1 = d.snapshot().pixels[0] } }] },
    { kind: 'codeair', source: LISTENER_CODEAIR },
  ] })
  for (const r of results) assert.ok(!r.error, r.output)
  assert.ok(greenAt1[1] > 0 && greenAt1[0] === 0, `after A: ${greenAt1}`)
  for (const r of results.slice(1)) {
    const p = r.device.snapshot().pixels[0]
    assert.ok(p[0] > 0 && p[1] === 0, `after B: ${p}`)
  }
})

console.log('infrared')

await test('infrared: the devices\' own infrared.py, between boards and back to the sender', async () => {
  const { results } = await runHeadlessGroup({ seconds: 8, devices: [
    { kind: 'codex', source: 'import infrared, time\nfrom codex import *\nir = infrared.Infrared(power)\ntime.sleep(1.5)\nir.send("Hi!")\nprint(ir.receive())\nir.send("ok")\nir.flush()\nprint(ir.receive())' },
    { kind: 'codeair', source: 'import infrared, time\nfrom codeair import *\nir = infrared.Infrared()\nheard = []\nfor i in range(200):\n    heard += ir.receive_queue()\n    time.sleep(0.02)\nprint(heard)' },
  ] })
  assert.deepEqual(results.map((r) => r.output.trim()), ['Hi!\nNone', "['Hi!', 'ok']"])
})

await test('CodeAIR\'s factory program pairs with a CodeX remote by infrared, then flies by radio', async () => {
  const press = (n, t, d = 0.3) => [{ t, fn: (w, dv) => dv.press(n, true) }, { t: t + d, fn: (w, dv) => dv.press(n, false) }]
  let top = 0
  const { results } = await runHeadlessGroup({ seconds: 16, devices: [
    { kind: 'codex', source: REMOTE_FOR_CODEAIR, inputs: [...press(5, 1, 2), ...press(4, 5), ...press(0, 9, 1.5), ...press(5, 12)] },
    { kind: 'codeair', source: XFLY_CODEAIR, env: haveGym ? 'gym' : 'empty', setup: (w, d) => w.onTick(() => { top = Math.max(top, d.z) }) },
  ] })
  const [remote, air] = results
  assert.ok(!remote.error && !air.error, remote.output + air.output)
  assert.match(air.output, /Ctrl mode: ch=\d+, nid=\d+/)
  assert.ok(top > 0.3, `it rose to ${top.toFixed(2)} m`)
  assert.ok(air.device.z < 0.02 && air.device.y > 0.15, `it ended at z ${air.device.z.toFixed(2)}, y ${air.device.y.toFixed(2)}`)
})

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

if (failed) { console.log(`${failed} failed`); process.exit(1) }
process.exit(0)
