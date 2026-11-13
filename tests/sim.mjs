// Simulator tests: real programs on a simulated CodeBot, headless.
//   node tests/sim.mjs
// Uses the gym when its built assets are present (they are not published
// yet), and an empty room otherwise.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { runHeadless, runHeadlessGroup } from '../src/sim/headless.js'
import { REMOTE_CODEX, LISTENER_CODEX, LISTENER_CODEAIR, REMOTE_FOR_CODEAIR, XFLY_CODEAIR } from '../src/sim/boards/examples.js'
import { COURSES, courseShape } from '../src/sim/world/courses.js'
import { CB3 } from '../src/sim/world/codebot.js'
import { AIR } from '../src/sim/world/codeair.js'
import { ROOMS } from '../src/sim/kinds.js'
import { describe, change, compass } from '../src/sim/describe.js'
import { loadEnvironment } from '../src/sim/headless.js'
import { Engine } from '../src/sim/runtime/engine.js'
import { World } from '../src/sim/world/world.js'
import { Environment } from '../src/sim/world/environment.js'
import { createDevice } from '../src/sim/devices.js'
import { pythonFiles, haveFlight } from '../src/sim/headless.js'

const haveGym = fs.existsSync(new URL('../public/sim-assets/env/gym/world.json', import.meta.url))
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log('  ok  ', name) } catch (e) { failed++; console.log('  FAIL', name, '\n      ', e.message) }
}
// A test that needs a CodeAIR that flies: its flight library is fetched only
// for a build with CodeAIR flight (sim/tools/flight-library.mjs).
const flightTest = haveFlight() ? test : async (name) => console.log('  skip ', name, '(no CodeAIR flight library: SIM_FLIGHT=1 npm run sim:flight)')

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

// The drive is a gearmotor model from the hardware (sim/DESIGN.md,
// "Calibration"): what it claims, through the real botcore.
await test('drives as its gearmotors would: a deadband, then faster with more power, spins too', async () => {
  const drive = async (l, r, run, coast = 0) => {
    const res = await runHeadless({
      source: `from botcore import *\nimport time\nmotors.enable(True)\nmotors.run(LEFT, ${l})\nmotors.run(RIGHT, ${r})\ntime.sleep(${run})\nmotors.run(LEFT, 0)\nmotors.run(RIGHT, 0)\ntime.sleep(${coast})`,
      seconds: run + coast + 0.5, traceEveryMs: 10,
    })
    const at = (t) => res.trace.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a))
    // heading turned between two times, unwrapped (it may turn past 180 in a trace step)
    const turned = (t0, t1) => {
      let sum = 0
      const pts = res.trace.filter((p) => p.t >= t0 && p.t <= t1)
      for (let i = 1; i < pts.length; i++) sum += ((pts[i].heading - pts[i - 1].heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
      return (sum * 180) / Math.PI
    }
    return { at, start: res.trace[0], turned }
  }
  const speeds = []
  for (const p of [10, 20, 50, 100]) {
    const { at, start } = await drive(p, p, 2, 1)
    const dist = (t) => Math.hypot(at(t).x - start.x, at(t).y - start.y)
    speeds.push((dist(2) - dist(1.5)) / 0.5)
    if (p === 100) {
      // 1:48 gearmotors on 65 mm wheels at 6 V: about 0.6 m/s, and it coasts a few hand-widths
      assert.ok(speeds.at(-1) > 0.5 && speeds.at(-1) < 0.7, `full power, ${speeds.at(-1).toFixed(3)} m/s`)
      const coast = dist(3) - dist(2)
      assert.ok(coast > 0.05 && coast < 0.4, `coasted ${coast.toFixed(3)} m`)
    }
  }
  assert.ok(speeds[0] < 0.001, `10% is inside the deadband, yet it moved at ${speeds[0].toFixed(4)} m/s`)
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], `speeds by power ${speeds.map((s) => s.toFixed(3))}`)
  const spins = []
  for (const p of [25, 50, 100]) {
    const { turned } = await drive(-p, p, 2)
    spins.push(turned(1.5, 2) * 2)
  }
  for (let i = 1; i < spins.length; i++) assert.ok(spins[i] > spins[i - 1], `spin rates by power ${spins.map((s) => s.toFixed(0))} deg/s`)
  // a pivot on one wheel turns the robot toward the stopped wheel
  const { turned } = await drive(0, 50, 2)
  assert.ok(turned(1.5, 2) > 20, `pivot on the left wheel turned ${turned(1.5, 2).toFixed(0)} deg in half a second`)
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
  // The court's wood reads about 2100 to 2600 and its painted lines about
  // 1000 (as in CodeSpace's simulator), so the threshold sits between them.
  await test('gym: the line sensors see the court lines', async () => {
    const r = await runHeadless({
      env: 'gym', spawn: { x: 0.3, y: 0, heading: Math.PI / 2 },
      source: `from botcore import *
import time
motors.enable(True)
motors.run(LEFT, 60)
motors.run(RIGHT, 60)
seen = 0
for i in range(600):
    if ls.check(1500, True)[2]:
        seen += 1
    time.sleep(0.01)
print(seen)`,
    })
    const seen = Number(r.output)
    assert.ok(seen > 3 && seen < 300, `saw a line ${r.output.trim()} times in 600`)
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
// The share of a run the line sensors' middle spends off the tape. Over the
// gap (the gap course's 120 mm break, mid top straight) there is no tape to be
// on, so that stretch does not count: how long it takes to cross depends on
// the speed at 30%, not on following.
function offTape(r, course) {
  const floor = r.world.env.floor
  const ahead = CB3.lineSensors[2][0]
  const sensor = (p) => [p.x + ahead * Math.cos(p.heading), p.y + ahead * Math.sin(p.heading)]
  const overGap = ([x, y]) => course === 'gap' && Math.abs(x) < 0.1 && Math.abs(y - 0.5) < 0.05
  const counted = r.trace.filter((p) => !overGap(sensor(p)))
  const off = counted.filter((p) => floor.reflectance(...sensor(p), 0.03) > 0.6)
  return off.length / counted.length
}
for (const course of ['oval', 'eight', 'gap']) {
  await test(`a follower goes round the ${COURSES[course].name.toLowerCase()} and keeps to it`, async () => {
    const r = await runHeadless({ source: FOLLOW, course, env: haveGym ? 'gym' : 'empty', seconds: 20, traceEveryMs: 100 })
    assert.ok(!r.error, r.output)
    const dist = r.trace.reduce((a, p, i) => (i ? a + Math.hypot(p.x - r.trace[i - 1].x, p.y - r.trace[i - 1].y) : 0), 0)
    // 20 s at mostly 40% (0.17 m/s), less what the turns take
    assert.ok(dist > 3.0, `went ${dist.toFixed(1)} m`)
    assert.ok(offTape(r, course) < 0.03, `off the tape ${(offTape(r, course) * 100).toFixed(0)}% of the time`)
  })
}

// The stem is 19 mm wide and the sensors 9.7 mm apart, so sensors 1 and 3 sit
// on its edges, about half over tape: they read near 2300, dark by ls.check()'s
// default 1000, so three sensors see the stem.
await test('on the T it starts on the stem (a 19 mm tape under three sensors), and the crossbar reads on all five', async () => {
  const r = await runHeadless({
    course: 'tee', env: 'empty', seconds: 15,
    source: `from botcore import *\nimport time\nprint(ls.check())\nmotors.enable(True)\nmotors.run(LEFT, 50)\nmotors.run(RIGHT, 50)\nwhile not all(ls.check()):\n    time.sleep(0.005)\nmotors.enable(False)\nprint('bar')`,
  })
  assert.equal(r.error, undefined, r.output)
  const [first, last] = r.output.trim().split('\n')
  assert.equal(first, '(False, True, True, True, False)')
  assert.equal(last, 'bar')
  const sensorsY = r.device.y + CB3.lineSensors[2][0]
  assert.ok(Math.abs(sensorsY - 0.5) < 0.03, `stopped with its sensors at y ${sensorsY.toFixed(3)}`)
})

console.log('CodeAIR')

const air = (source, opts = {}) => runHeadless({ kind: 'codeair', env: 'empty', seconds: 40, traceEveryMs: 20, ...opts, source })
const PRE = 'from codeair import *\nfrom flight import *\nimport time\n'

await flightTest('take off, hold, and land, with its own motion commander', async () => {
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

await flightTest('the rotors whine as the motors turn: up to take off, steady in a hover, apart in a turn, silent when stopped', async () => {
  const r = await air(PRE + 'time.sleep(0.5)\nfly.take_off(0.5)\nfly.steady(1)\nfly.turn_left(90)\nfly.steady(1)\nfly.land()\ntime.sleep(1.5)')
  const pitch = (s) => s.whine.reduce((a, v) => a + v.freq, 0) / s.whine.length
  const diagonals = ({ whine: w }) => Math.abs(w[0].freq + w[2].freq - w[1].freq - w[3].freq) / 2
  const at = (t0, t1) => r.trace.filter((s) => s.t >= t0 && s.t < t1)
  assert.ok(r.trace.filter((s) => !s.motors && s.z === 0 && s.t < 1).every((s) => s.whine.length === 0), 'whined before the motors ran')
  // spawned facing +y: the turn starts when the heading leaves 90 degrees
  const turn = r.trace.find((s) => s.heading > Math.PI / 2 + 0.03).t
  const climbing = r.trace.filter((s) => s.motors && s.z > 0.1 && s.z < 0.4 && s.t < turn)
  const hover = at(turn - 0.4, turn - 0.05)
  const landing = r.trace.filter((s) => s.motors && s.z > 0.1 && s.z < 0.4 && s.t > turn)
  assert.ok(climbing.length && hover.length && landing.length)
  const mean = (ss, f) => ss.reduce((a, s) => a + f(s), 0) / ss.length
  const [up, still, down] = [mean(climbing, pitch), mean(hover, pitch), mean(landing, pitch)]
  assert.ok(Math.abs(still - AIR.whineHz) < 0.05 * AIR.whineHz, `hovers at ${still} Hz`)
  assert.ok(up > still * 1.04 && down < still * 0.96, `climbs at ${up} Hz, hovers at ${still}, sinks at ${down}`)
  assert.ok(Math.abs(mean(hover, (s) => s.whine[0].level) - 0.5) < 0.05)
  // a turn works one diagonal pair against the other
  const turning = Math.max(...at(turn, turn + 1.5).map(diagonals)), steady = Math.max(...hover.map(diagonals))
  assert.ok(turning > steady + 20, `diagonals ${turning} Hz apart in the turn, ${steady} Hz in the hover`)
  assert.equal(r.device.snapshot().whine.length, 0, 'still whining after it landed')
})

await flightTest('forward and turn go about as far as asked, with some drift', async () => {
  const r = await air(PRE + 'fly.take_off(0.4)\nfly.forward(1.0)\nfly.turn_left(90)\nfly.land()')
  const end = r.trace.at(-1)
  // spawned at the centre facing +y
  assert.ok(Math.abs(end.y - 1.0) < 0.25 && Math.abs(end.x) < 0.25, `ended at ${end.x}, ${end.y}`)
  // turn_left(90) polls for round(12.5) = 12 tenths of a second: 86.4 degrees on the drone
  const turned = ((end.heading - Math.PI / 2) * 180) / Math.PI
  assert.ok(Math.abs(turned - 86.4) < 8, `turned ${turned} degrees`)
})

await flightTest('the same seed flies the same path, bit for bit', async () => {
  const src = PRE + 'fly.take_off(0.4)\nfly.forward(0.5)\nfly.circle_left(0.3)\nfly.land()'
  const [a, b] = [await air(src), await air(src)]
  assert.deepEqual(a.trace.map((s) => [s.x, s.y, s.z]), b.trace.map((s) => [s.x, s.y, s.z]))
  const c = await air(src, { seed: 2 })
  assert.notDeepEqual(a.trace.map((s) => s.x), c.trace.map((s) => s.x))
})

await flightTest('with no setpoints for 2 s the flight controller stops the motors, and it falls', async () => {
  const r = await air(PRE + 'fly.take_off(0.8)\ntime.sleep(3)\nprint(fly.is_flying())')
  const t0 = r.trace.find((s) => s.z > 0.75).t
  const fell = r.trace.find((s) => s.t > t0 && !s.motors && s.z > 0.5)
  assert.ok(fell, 'the motors never stopped in the air')
  assert.ok(r.device.z < 0.001, `still at ${r.device.z} m`)
  assert.equal(r.output.trim(), 'True')          // the program does not know
})

await flightTest('a stop inside `with recorder:` lands it, as on the drone', async () => {
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

await flightTest('a wall stops it, and the rangers see the room', async () => {
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

await flightTest('its board: LEDs, NeoPixels, buttons, speaker, battery, parameters', async () => {
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

console.log('rooms')

// An upright cylinder, as the rooms' table legs are: in world.json's shape.
const cylinder = (name, x, y, r, z0, z1) => ({ name, min: [x - r, y - r, z0], max: [x + r, y + r, z1], c: [x, y], r })

await test('a table leg (an upright cylinder) stops a CodeBot, and its proximity sensors see it', async () => {
  const env = new Environment({ id: 'leg', floor: null, obstacles: [cylinder('leg', 0, 0.5, 0.02, 0, 0.7)], spawns: [{ x: 0, y: 0, heading: Math.PI / 2 }] })
  const world = new World(env)
  const bot = world.add(createDevice('codebot', env, world.rng.fork(), env.spawns[0]))
  // the left sensor is 36 mm left of the centre line, so its beam meets the leg
  const d = bot.proxDistance(0)
  assert.ok(d > 0.25 && d < 0.4, `saw it at ${d} m`)
  bot.enable(true); bot.setPower(0, 60); bot.setPower(1, 60)
  world.advance(4e6)
  // stopped with its body (its collision circle, ahead of the axle) against the leg
  const front = bot.y + CB3.bodyCenter + CB3.bodyRadius
  assert.ok(bot.blocked && front > 0.47 && front < 0.49, `body front at ${front}, blocked ${bot.blocked}`)
  assert.ok(Math.abs(bot.x) < 0.02, `pushed aside to ${bot.x}`)
})

const ROOM_IDS = Object.keys(ROOMS).filter((id) => fs.existsSync(new URL(`../public/sim-assets/env/${id}/world.json`, import.meta.url)))
if (ROOM_IDS.length < Object.keys(ROOMS).length) console.log(`  skip  rooms not built: ${Object.keys(ROOMS).filter((id) => !ROOM_IDS.includes(id)).join(', ')} (npm run sim:assets)`)

for (const id of ROOM_IDS) {
  await test(`${id}: a board starts on clear floor, and every course lies on clear floor`, async () => {
    const env = await loadEnvironment(id)
    const p = CB3
    // the start: on its floor, and the body touching nothing
    const s = env.spawns[0], z = s.z ?? 0
    assert.ok(Math.abs(env.supportAt(s.x, s.y, z, p.step) - z) < 0.005, `the start is not on its floor (${z} m)`)
    const band = env.obstaclesIn(z + p.step, z + 0.5)
    const bx = s.x + p.bodyCenter * Math.cos(s.heading), by = s.y + p.bodyCenter * Math.sin(s.heading)
    const hit = band.find((o) => Math.hypot(...Environment.nearest(o, bx, by).map((v, i) => v - [bx, by][i])) < p.bodyRadius + 0.1)
    assert.ok(!hit, `the start is within 10 cm of ${hit?.name}`)
    // each course: its mat, and 15 cm round it, on one level and clear up to half a metre
    for (const [cid, c] of Object.entries(COURSES)) {
      const shape = courseShape(cid, env)
      const [x0, y0, x1, y1] = shape.mat, m = 0.15
      const near = env.obstaclesIn(shape.z + p.step, shape.z + 0.5).find((o) => {
        const qx = Math.min(Math.max(o.r ? o.c[0] : (o.min[0] + o.max[0]) / 2, x0 - m), x1 + m)
        const qy = Math.min(Math.max(o.r ? o.c[1] : (o.min[1] + o.max[1]) / 2, y0 - m), y1 + m)
        const [nx, ny] = Environment.nearest(o, qx, qy)
        return nx >= x0 - m && nx <= x1 + m && ny >= y0 - m && ny <= y1 + m
      })
      assert.ok(!near, `${c.name}: ${near?.name} is on or by the mat`)
      for (let x = x0 - m; x <= x1 + m; x += 0.05) {
        for (let y = y0 - m; y <= y1 + m; y += 0.05) {
          const g = env.supportAt(x, y, shape.z, p.step)
          assert.ok(Math.abs(g - shape.z) < 0.005, `${c.name}: the floor at (${x.toFixed(2)}, ${y.toFixed(2)}) is at ${g} m, not ${shape.z}`)
        }
      }
    }
  })

  if (id !== 'gym') {
    await test(`${id}: a follower keeps to the oval`, async () => {
      const r = await runHeadless({ source: FOLLOW, course: 'oval', env: id, seconds: 15, traceEveryMs: 100 })
      assert.ok(!r.error, r.output)
      const dist = r.trace.reduce((a, q, i) => (i ? a + Math.hypot(q.x - r.trace[i - 1].x, q.y - r.trace[i - 1].y) : 0), 0)
      assert.ok(dist > 2.4, `went ${dist.toFixed(1)} m`)
      assert.ok(offTape(r) < 0.03, `off the tape ${(offTape(r) * 100).toFixed(0)}% of the time`)
    })
  }
}

if (ROOM_IDS.includes('auditorium')) {
  await test('auditorium: a CodeBot driven off the stage sees the edge, then falls to the floor', async () => {
    const env = await loadEnvironment('auditorium')
    const world = new World(env)
    const bot = world.add(createDevice('codebot', env, world.rng.fork(), env.spawns[0]))
    const stage = bot.z
    assert.ok(stage > 0.9, `starts at ${stage} m`)
    const onStage = bot.lineRead(2)
    // 2.4 m to the front of the apron
    bot.enable(true); bot.setPower(0, 60); bot.setPower(1, 60)
    let edge = null
    while (bot.z === stage && world.timeUs < 15e6) {
      world.advance(5000)
      if (edge === null && bot.lineRead(2) > 3800) edge = { t: world.timeUs, z: bot.z }
    }
    assert.ok(edge && edge.z === stage, 'its middle line sensor never saw the edge from the stage')
    assert.ok(onStage < 3800, `on the stage it read ${onStage}, as over the edge`)
    assert.ok(bot.z < 0.01, `fell to ${bot.z} m`)
    // and on the floor it bumps into the stage it fell from
    bot.setPower(0, -60); bot.setPower(1, -60)
    world.advance(3e6)
    assert.ok(bot.z < 0.01 && bot.blocked, `backing up: at ${bot.z} m, blocked ${bot.blocked}`)
  })

  await flightTest('auditorium: CodeAIR takes off from the stage, holds its height above it, and lands back on it', async () => {
    let top = 0
    const r = await air(PRE + 'fly.take_off(0.5)\nfly.steady(2)\nprint(round(get_data(RANGERS)[2] / 1000, 1))\nfly.land()\nfly.steady(1)', {
      env: 'auditorium',
      setup: (w, d) => w.onTick(() => { if (w.timeUs > 6e6 && w.timeUs < 7e6) top = Math.max(top, d.z) }),
    })
    assert.equal(r.error, undefined, r.output)
    assert.equal(r.output.trim(), '0.5')
    const stage = r.world.env.spawns[0].z
    assert.ok(Math.abs(top - stage - 0.5) < 0.04, `held at ${top} m, the stage at ${stage} m`)
    assert.ok(Math.abs(r.device.z - stage) < 0.01 && !r.device.motors, `ended at ${r.device.z} m, motors ${r.device.motors}`)
  })
}

console.log('in words, for a screen reader')

await test('a board described: where, which way, what it is doing; and what changed', async () => {
  const bot = { kind: 'codebot', x: 0.32, y: -1.04, z: 0, heading: Math.PI / 2, leds: { user: 0b101 }, tone: 440, blocked: false }
  const text = describe(bot, { room: 'classroom', motion: 'moving' })
  assert.match(text, /^Simulated CodeBot in the classroom, about 0\.3 m east and 1\.0 m south of the room's middle, facing north, driving forward\./)
  assert.match(text, /2 of 8 user lights on\. Its speaker plays 440 hertz\./)
  assert.equal(compass(-Math.PI / 2), 'south')
  assert.equal(compass(3 * Math.PI / 4 + 0.1), 'north-west')
  assert.equal(change(bot, { ...bot, blocked: true }, 'moving', 'still'), 'Bumped into something.')
  assert.equal(change({ ...bot, z: 0.97 }, bot, 'moving', 'moving'), 'Fell off the edge.')
  assert.equal(change(bot, bot, 'moving', 'still'), 'Stopped.')
  assert.equal(change(bot, bot, 'still', 'still'), null)
  const air = { kind: 'codeair', x: 0, y: 0, z: 1.47, above: 0.5, heading: 0, motors: true, pixels: [[0, 0, 9], [0, 0, 0]] }
  assert.match(describe(air, { room: 'auditorium' }), /CodeAIR in the auditorium, flying 0\.5 m up,.*Motors on\. 1 of 8 NeoPixels lit\./)
  assert.equal(change({ ...air, above: 0 }, air, 'still', 'still'), 'Took off.')
  assert.match(describe({ kind: 'codex', pixels: [[1, 0, 0]], leds: [1, 0, 0, 0, 0, 0] }), /1 of 4 NeoPixels lit, 1 of 6 red LEDs on/)
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

await flightTest('the boards page examples: a CodeX remote lights the listeners', async () => {
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

await flightTest('infrared: the devices\' own infrared.py, between boards and back to the sender', async () => {
  const { results } = await runHeadlessGroup({ seconds: 8, devices: [
    { kind: 'codex', source: 'import infrared, time\nfrom codex import *\nir = infrared.Infrared(power)\ntime.sleep(1.5)\nir.send("Hi!")\nprint(ir.receive())\nir.send("ok")\nir.flush()\nprint(ir.receive())' },
    { kind: 'codeair', source: 'import infrared, time\nfrom codeair import *\nir = infrared.Infrared()\nheard = []\nfor i in range(200):\n    heard += ir.receive_queue()\n    time.sleep(0.02)\nprint(heard)' },
  ] })
  assert.deepEqual(results.map((r) => r.output.trim()), ['Hi!\nNone', "['Hi!', 'ok']"])
})

await flightTest('CodeAIR\'s factory program pairs with a CodeX remote by infrared, then flies by radio', async () => {
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
