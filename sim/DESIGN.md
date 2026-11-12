# BotBlocks simulator: design

A browser simulator of Firia Labs' devices inside BotBlocks (Open CodeBot): CodeBot in a
gymnasium first, then CodeX, then CodeAIR. A student's program runs unchanged on the
simulator and on the hardware, and the whole product can be tested in the cloud with no USB
device.

Status: approved 2026-11-11. CodeBot in the gymnasium is built (steps 1 to 4
below, short of calibration); see "Where it stands" at the end. How to build,
test and extend it is in [README.md](README.md).

## The design in one paragraph

The student's Python and the whole world simulation run together in one Web Worker, on
simulated time. Python is a custom MicroPython WebAssembly build that suspends through
JavaScript Promise Integration (JSPI), so a `while True:` loop never blocks the page and
needs no SharedArrayBuffer (GitHub Pages cannot send the cross-origin isolation headers).
The world is a purpose-built 2D model per device, not a physics engine: 0.3 microseconds
a step, deterministic, every behaviour a named parameter. Sensors are read from the model
directly (the line sensors from a floor reflectance map, proximity from 2D geometry). The
main thread only draws: Three.js renders snapshots the worker posts. The same simulation
module runs in Node with no renderer for automated tests.

```
 main thread                              worker
 +-----------------------------+          +--------------------------------------+
 | BotBlocks UI, editors       |  run,    | MicroPython (wasm, JSPI)             |
 | SimDevice (device target)   |--stop,-->|   student program                    |
 |                             |  pause,  |   frozen shims: botcore, codex, ...  |
 | Three.js renderer           |  step,   |        | calls      ^ sensor values   |
 |   interpolates snapshots    |  input   |        v            |                 |
 | terminal, LEDs, speaker     |<---------| World: fixed 1 ms tick, seeded RNG   |
 +-----------------------------+ snapshots|   drive model, collisions, sensors   |
                                 stdout   +--------------------------------------+
                                          (the same World runs headless in Node)
```

## 1. Python: MicroPython on WebAssembly with JSPI

The devices run CircuitPython, a MicroPython fork. There is no CircuitPython WebAssembly
port, so the simulator uses MicroPython's own `ports/webassembly`, with the CircuitPython
and Firia modules supplied as frozen Python shims.

Measured (Chromium 151 headless and Node 24, Linux):

| | MicroPython, custom `sim` variant | Pyodide 314 |
|---|---|---|
| Download (brotli) | 139 KB wasm + 28 KB js | about 5.4 MB |
| Load to first `print` | 24 to 31 ms (673 ms the first time the browser compiles it) | 1.8 to 2.2 s (Node) |
| 1e6 loop with a call | 172 ms | 177 ms |
| Stop a `while True:` | 1.2 ms, VM stays usable | needs SharedArrayBuffer |

Pyodide is CPython, 30 times bigger, 80 times slower to start, and not the dialect the
devices run. Brython (the old simulator) gave poor error lines and was slow. MicroPython
matches the device, is small, and is as fast as CPython here.

Of MicroPython's own builds, the JSPI one (upstream's `browser` variant) is 5.7 times faster
than the Asyncify one (`pyscript`). JSPI ships in Chrome and Edge 137 and later (May 2025),
which covers supported Chromebooks. Firefox and Safari are shipping it during 2026; until
they have it, those browsers get the same design on an Asyncify build (slower, still
correct).

### Running without blocking the page

Every alternative was weighed:

- **Worker plus SharedArrayBuffer** (the old design): needs COOP/COEP headers. GitHub Pages
  cannot send them; coi-serviceworker can fake them at the cost of a forced reload on first
  visit, reload loops in some layouts, and blocked cross-origin assets. Rejected.
- **Main thread with cooperative yielding**: any slow frame stutters the editor and the
  renderer. Rejected.
- **Worker with the VM and the world together, suspending through JSPI**: chosen. The world
  lives in the worker, so the student's code reads sensors with a plain function call, no
  cross-thread memory at all. When the VM suspends, the worker's event loop runs and
  receives messages.

How time works (all built and measured in the prototype, `sim/runtime/`):

- **Simulated time is the only clock.** `time.sleep`, `time.monotonic`, `ticks_ms` and
  every timed API read and advance the world's clock, never the wall clock.
- **`time.sleep(t)`** steps the world t seconds, then suspends.
- **A tight loop** is charged simulated time per bytecode branch: a counter in the VM hook
  calls the world every 1,000 branches (overhead not measurable) and steps it by
  branches times a per-branch cost calibrated against a real CB3.
- **Suspending**: once 16 ms of simulated or wall time has passed, the VM suspends (23
  microseconds a time). The worker posts a snapshot, handles messages, and paces itself
  against real time (1x, or faster for tests, or as fast as it can).
- **Stop** sets a flag; the next suspension raises `KeyboardInterrupt` in the program. A
  program whose bare `except:` swallows it gets it again at every suspension, and after
  500 ms the worker is terminated and restarted.
- **Pause** holds the suspension on a promise; **step** releases it for one suspension, or
  (in the debugger) one line.
- **Determinism**: the VM has no hash randomization and dict order is insertion order; the
  random seed and every source of noise come from one seeded generator. Two runs of the
  same program are bit-identical (measured).

### The device modules

A frozen module per device, named and shaped exactly as on the hardware
(docs.firialabs.com): `botcore` for CodeBot (`motors`, `leds`, `ls`, `prox`, `enc`,
`spkr`, `buttons`, `accel`, `system`, `exp`), `codex` (`display`, `buttons`, `leds`,
`pixels`, `audio`, `accel`, `light`, `power`, `tft`) and `codeair` plus `flight` (`fly`,
`fly_high`, `pixels`, `leds`, `speaker`, `buttons`, `power`, sensors). The shims check
arguments as the device does and call into the world through a small native module. The
modules that are Python on the device (`botservices`, `colors`, `songplayer`, `sprite`,
`soundlib`, the cflib commanders) run unchanged where the sources are available, over a thin
CircuitPython layer (`board`, `digitalio`, `analogio`, `pwmio`, `neopixel`, `time`). The C
ones (`Canvas`, `Bitmap`, `tft`, `radio`) are reimplemented in C in the build or in Python
over a framebuffer.

`radio` works between simulated devices, so radio programs can be tried with two or more
simulated boards. Each board in a browser has its own worker; a `BroadcastChannel` carries a
message to every other board of the app, on the boards page (`boards.html`, linked from the
simulator bar) and in other tabs of the same browser, as a class's devices on one desk hear
each other. Each `Radio` (`world/radio.js`) holds what is in the air toward it and what it
has heard; a message is judged against the receiver's on/off and channel when it lands, the
radio's latency after it was sent. Headless, `runHeadlessGroup` keeps several devices on one
timeline in lockstep (`runtime/lockstep.js`): no world runs more than a 10 ms slice ahead of
the slowest, and a message lands no sooner than the next barrier, so a conversation between
devices is the same on every run. Their VMs share one JS realm, which MicroPython's web port
does not expect (it keeps its proxy tables on `globalThis`): each VM comes from its own copy
of the loader module, the engine swaps those globals as VMs take turns, and the barrier
releases one engine per task so two never resume together.

Error messages follow the device's where students see them (the traceback the terminal shows
and the `program-error` event the app parses).

## 2. The world: purpose-built models, no physics engine

Measured cost per 1 ms step in Node: Rapier 24.5 microseconds, Jolt 8.2, cannon-es 8.3,
the purpose-built model 0.32 including five line sensors. Rapier would add 1.2 MB gzip;
the model adds nothing.

A general engine would also need careful tuning to keep a 15 cm, half-kilogram robot from
jittering, and gives no more fidelity for what students observe. So each device gets a
model written for it, run on a fixed 1 ms tick with integer tick counts and a seeded sfc32
generator. Trigonometry in the state path uses our own polynomial functions so results match
across browsers (V8 agrees across x86 and ARM; Firefox and Safari's `Math.sin` need not).

**CodeBot.** A 2D differential drive. Motor power to target wheel speed (linear, with an
optional deadband and battery scaling) and a first-order lag (35 ms); a wheel's slowing
clamped to a braking limit; the turn rate cut by scrub and slip; the body as a circle or oriented box against wall segments and prop shapes,
pushed out along the contact normal; when it is blocked, the wheels stall and the encoders
stop, as on the real robot. Constants from the CB3 itself: the old simulator's dimensions
are from the CB2 model (wheel 65 mm, track about 111 mm, line sensors 61 mm ahead at 0,
plus or minus 9.7 and 19.1 mm) and are re-measured on a CB3 before they are trusted.

**CodeAIR.** Arcade flight under a simulated flight controller. On the drone the ESP32's
Python reaches the STM32 (Crazyflie firmware) only through the C module `crtp`, so the
simulator puts a virtual Crazyflie behind that module (`world/crazyflie.js`): it decodes
CRTP as the firmware does (parameters, log blocks, the generic, legacy and high-level
commanders, platform, link), keeps the firmware's setpoint watchdog (stale after 500 ms:
level and hold height; after 2 s: motors off, and it falls), and streams log values
computed from the room. The device's own `flight`, `flightdb`, `cflib` and `recorder` run
unchanged over it. Under that, the airframe (`world/codeair.js`): setpoint velocities,
height and yaw rate reached through first-order lags; seeded Ornstein-Uhlenbeck drift,
doubled near the floor; a flat puck against the floor and the room's boxes, bouncing with
restitution and a random sideways kick; free fall with the motors off. Blocking calls
(`fly.forward(0.5)`) poll setpoints on simulated time, as on the drone.

**CodeX.** No physics. Tilt comes from the user (drag the device, or a phone's orientation)
as gravity in the device frame.

**Rooms** (`world/environment.js`). A room's physics is CodeSpace's impostors: axis-aligned
boxes and upright cylinders (table legs, pillars), each meeting a device only in its band of
heights, so a CodeBot drives under a table a CodeAIR hits. The top of any obstacle is also a
floor (`supportAt`): the auditorium's stage is a box 0.97 m high. CodeBot and CodeAIR carry a
height. A CodeBot drives over a ledge up to 1 cm; past a higher one, once its body's centre is
over the drop, it falls and lands on its wheels clear of the ledge (a real one would tumble:
a simplification), and its line sensors read a drop as black, as a real sensor gets no light
back. CodeAIR's heights (its setpoints, its state estimate) are from where it took off, and
its rangers and ground effect from whatever is under it. Line courses are laid where each
room has clear floor (its `courseAt`, on the stage in the auditorium).

If pushable props ever need real 3D physics, `rapier3d-deterministic` is the fallback: it
documents bit-exact cross-platform results in wasm.

## 3. Sensors, from their physical counterparts

- **Line sensors**: each environment comes with a top-down floor reflectance map (8-bit,
  about 2 cm a pixel, built from the floor texture at build time). Each sensor averages
  its real footprint through a summed-area table (constant time), maps reflectance through
  the sensor's response curve (0 brightest to 4095, as `ls.read`), and adds seeded noise. No
  raycasts.
- **Proximity**: five to seven rays across each emitter's cone in 2D against wall segments
  and prop shapes, the nearest weighted by surface reflectance and a falloff curve, then the
  device's `detect` power and sensitivity semantics. The old simulator's range table,
  measured on a real CodeBot, calibrates it. Computed at 100 Hz or on demand, not every tick.
- **Encoders**: integrate wheel angle, 20 slots a revolution; `enc.read` returns the analog
  slot signal with noise, `is_slot` the edge state, as on the hardware.
- **Accelerometer**: specific force (acceleration less gravity) in the body frame, from the
  model's filtered velocity change, plus bias, noise and a spike on each collision; signed
  16-bit at plus or minus 2 g.
- **Light**: a precomputed 2D illuminance grid per environment plus contributions from
  simulated light sources.
- **Sound**: the speaker and `audio` drive a Web Audio oscillator on the main thread, from
  events in the snapshot stream, timed in simulated time. Microphone input, where an API
  reads it, comes from the page's microphone with permission, or silence.
- **Buttons**: clicks on the 3D model or the on-screen panel, and keys.

## 4. Rendering: Three.js on the main thread

| min+gzip | |
|---|---|
| Three.js WebGLRenderer + GLTFLoader | 158 KB |
| Three.js WebGPURenderer | 278 KB |
| Babylon.js 9, tree-shaken | 897 KB (300 KB first chunk) |

Three.js is a fifth the size of Babylon, and its classic WebGL2 renderer is the most proven
path on school Chromebooks' weak Intel and Mali GPUs. WebGPU waits: ChromeOS blocklists it
on older devices, and the WebGPU renderer is 75 percent larger. Raw WebGL would save 150 KB
at the cost of writing our own glTF and materials.

For Chromebooks, draw calls matter more than triangles:

- A build step (`gltf-transform`) merges each room's static meshes by material (the classroom
  goes from about 200 draw calls to about 24), compresses meshes with meshopt (a 10 KB
  decoder, no wasm) and textures to KTX2.
- Room lighting is baked into textures; each robot casts a blob shadow (one fitted 1024
  shadow map at most).
- The same build step extracts the world JSON the simulation uses: wall segments, prop
  shapes, spawn points, the floor reflectance map and the light grid. The simulation never
  loads a mesh.

The renderer interpolates between the two latest snapshots, so the picture is smooth at any
frame rate while the world runs at 1 kHz. OffscreenCanvas in a worker works (measured) and
stays an option if the main thread ever gets busy.

Cameras: an orbit camera, a chase camera that follows the robot, and a top-down view that
shows the floor lines, which is the view that helps most with line following.

## 5. Plugging into BotBlocks

The app's UI talks to one DeviceManager: `connect`, `disconnect`, `run(source)`, `stop`,
`sendRaw`, `isConnected`, `targetId`, `state`, and the events `state`, `device`, `data`,
`notice`, `progress`, `program-error`. A `SimDevice` implements that interface (or the
device target interface the other worker is defining, when it lands) for each simulated
board: `run` hands the source to the worker, `data` carries the program's output and the
REPL as terminal bytes, and `program-error` carries tracebacks as the hardware path does. No
fake serial protocol: the simulator does not pretend to be a REPL over raw bytes.

"Connect" offers the simulated boards beside the USB ones. The simulated board's view sits
in a panel beside the editors; CodeX's screen can go full screen for a class, with keyboard
keys mapped to its buttons (arrows for up, down, left and right; A and B for its buttons).

## 6. Headless and tests

The world and the runtime have no dependency on the renderer or the DOM. A Node harness
loads the same wasm and world module and runs a program to a simulated deadline as fast as
the CPU allows (a 30 second CodeBot program in well under a second), then returns the
trace: pose over time, LED states, output, errors. Tests are scripts that assert on that
trace, and CI hashes trajectories at checkpoints to catch any change in behaviour. Golden
screenshots use Playwright Chromium with software GL, sparingly. The existing `npm test`
gains a simulator suite, and the app's end-to-end tests can drive a simulated CodeBot
through the whole UI with no hardware.

## 7. Assets

The device and room GLBs come from CodeSpace's simulator and are committed in `sim/assets/`
under CC BY-NC 4.0 (its LICENSE; David, 2026-11-11). The derived files (merged meshes, world
JSON, reflectance maps) are generated into `public/sim-assets/` by `npm run sim:assets` and
not committed. Four rooms: the gymnasium, a classroom, the cafeteria and the auditorium. The
service worker keeps the gymnasium for offline use from the first visit, and each other room
once it has been chosen.

## 8. Build order

1. Runtime: the `sim` MicroPython variant in this repository (the patch in
   `sim/runtime/`), the build script, the worker, the Node harness.
2. World: the CodeBot model, the gymnasium's world JSON and reflectance map, the sensors,
   the `botcore` shim. Headless tests drive real student programs.
3. Rendering: Three.js view of the gymnasium and CodeBot, cameras, LEDs, sound.
4. BotBlocks: SimDevice, the connect choice, the view panel; blocks and Python editors run
   on the simulated CodeBot. Calibrate against a real CB3.
5. CodeX: `codex` shim, Canvas and Bitmap over a framebuffer, the screen panel, full screen
   with keyboard buttons.
6. CodeAIR: `codeair` and `flight` shims, the arcade flight model, its sensors.

## 9. Risks

- **JSPI outside Chromium.** Firefox and Safari fall back to the Asyncify build, about 5.7
  times slower but correct. Checked again before release.
- **Calibration.** CodeBot drives and reads lines as botsim does, CodeSpace's own simulated
  CodeBot, so lessons written against it drive the same distances. A real CB3 may differ
  ("Calibration" lists where); the per-bytecode time cost, CodeX and CodeAIR still need a
  bench. Until then those behave plausibly, not exactly.
- **The device's own Python sources.** The frozen Firia modules would run unchanged if their
  sources can ship in the simulator build; if they are not open, the shims reimplement them
  from the docs.
- **Patch upkeep.** The variant changes about 170 lines of MicroPython's port and is rebased
  on upstream releases.

## Research record

The measurements above came from prototypes built for this design (2026-11-11). The
runtime prototype became `src/sim/runtime/`; the rendering and physics benchmarks compared
Three.js r187, Babylon.js 9.35, Rapier 0.21, Jolt 1.1.1 and cannon-es 0.20 in headless
Chromium 151 and Node 24.

## Calibration

Every number a student could notice is a named parameter, and each is an estimate until it
is measured on a device:

- **CodeBot** (`CB3` in `src/sim/world/codebot.js`): wheel speed at full power, deadband,
  motor lag, traction; line sensor readings on white and black and their noise; the
  proximity beam's spread (its range table is measured); encoder signal levels; the
  accelerometer's axes and sign at rest. Sensor positions come from the CB3 model.
- **Device time** (`COST_US` in `src/sim/bridge/codebot.js`, `usPerBranch` in the engine):
  what a sensor read, a motor write and a bytecode cost on the device. A tight loop's
  iterations per second on a CB3 sets `usPerBranch`.

A bench session with a CB3, a tape line and a ruler settles all of these. Until then
(the manager, 2026-11-12: the real CB3 waits for the final testing rounds) CodeBot is
calibrated to CodeSpace's own simulated CodeBot (botsim, `src/entities/CodeBotModels.js`
and `CodeBotModelController.js` at `~/dev/firia/botsim-ref`), since CodeSpace's lessons
were written and tested against it (the manager's decision, 2026-11-12). What its source
says, and what running it showed:

- **How it was measured.** botsim's own `CodeBotModels.js`, unchanged, run headless in
  Node: Babylon 6.21 `NullEngine`, botsim's `public/ammo/ammo.js`, its physics settings
  (`AmmoJSPlugin(0)`, a 1/60 s step in 1/240 s slices, gravity 9.8) and a classroom
  ground (friction 0.8, restitution 0.7), with loader hooks standing in for its assets,
  scene and peripherals. No CodeSpace account and no Firebase. The harness is not in this
  repo (it imports CodeSpace's source); this paragraph is enough to write it again.
  botsim steps its physics 1/60 s per rendered frame, so on a machine below 60 frames a
  second its robot runs in slow motion against the clock: its numbers are at 60.
- **Motors.** Target wheel speed = power / 100 x 15 rad/s (`motorMaxAngularVelocity`),
  linear, no deadband: 0.49 m/s at 100%, 0.24 at 50%, and 10% still moves (0.05 m/s).
  Starting, the wheels reach 63% of their speed in 35 ms (`motorTau`); no acceleration
  limit shows. Stopping is slow: power cut (or the motors disabled, which botsim does the
  same way) the wheels slow at about 0.65 m/s² (`brake`), so from full speed it rolls
  19 cm in 0.7 s, from 50% 4 cm. Fitted, our model matches its distance at 2 s within
  2 mm at 10 to 100%, and its stopping distance within 15%.
- **Turning.** botsim's turn rate falls short of what the wheels give, and past a point
  falls: spinning (one wheel back, one forward) at 25, 50 and 100% it turns 119, 220 and
  188 deg/s, against 125, 250 and 500 from the wheels alone. Our model:
  `turnEfficiency x w / (1 + (w / turnSlip)^turnSlipExp)`, w the wheels' turn rate, fits
  the three spins within 2% and arcs (one wheel faster) within 5%. A pivot on one stopped
  wheel at full power runs 20% fast (216 deg/s against botsim's 180).
- **Line sensors.** A ray down from just under the board; the reading is
  4095 x (1 - r x (1 - d / 10 cm)), r the floor's three sRGB channels averaged as stored
  (a texture's texel, or an untextured material's colour factor unconverted) and d the
  ray's length. The robot rests nose-down on its skid, pitched 20 degrees, and the ray
  meets the floor at 7 mm (measured, not the 4 cm estimated before), so white reads 286 and
  black 4095. Starting hard lifts the nose for a moment (at 100%, 22 mm: white reads
  about 900), which this model leaves out. The room builder now makes floor maps the same
  way (it used linear luminance). CodeSpace's simulated lessons use thresholds of 2000,
  2300 and 3300 (and `ls.check()` with none, 1000), all between the two.
- **Proximity.** botsim always reads 4095 (off); its lessons that read proximity override
  it in their validators. Proximity stays on here: CodeSpace's real-robot lessons (Python
  with Robots, Hot Pursuit) read it on a CB3, and the range table was measured on one.
- **Encoders.** From the wheel's angle in the physics engine, 20 slots, edges counted. Ours
  count the wheel's own turning, so a robot that slips in a turn counts what its wheels
  did, as botsim's does.
- **Where a real CB3 may differ**, for the final testing rounds: its speed per power and any
  deadband (a real gearmotor stalls at low power); its stopping, likely much shorter than
  botsim's; its turn rates; what its line sensors read on white at their real height; and
  the nose lifting as it starts.

- **CodeAIR** (`AIR` in `src/sim/world/codeair.js`, constants in `crazyflie.js`): how
  closely it tracks a velocity, height and yaw rate (the lags and gains); how far it drifts
  in a hover, high and near the floor; how it bounces off a wall; how far above the floor
  `land()` cuts the motors; what a ranger reports with nothing in range (32767 here); the
  flow sensor's sign and scale; which way roll and pitch are signed in the log; how many log
  packets the `crtp` module queues (two here, so `get_data` is at most one period stale);
  the battery's voltage in flight. Positions of the LEDs and NeoPixels on the figure are
  from the board's silkscreen.

## Where it stands

Built, on branch `sim` (pushed to firialabs/opencodebot):

- The runtime: MicroPython with JSPI, every clock on simulated time, pause, step, stop
  (with a grace period for programs that swallow the interrupt), a REPL between programs,
  one fresh VM per run.
- CodeBot in the gymnasium: drive, walls and stalls, line sensors over the court lines,
  proximity, encoders, accelerometer, buttons, LEDs, speaker.
- In the app: a Simulate button, a Simulator tab (follow, orbit and top cameras, pause,
  step, speed, the board's buttons, reset), output and errors through the app's usual
  events, sound.
- Tests: `tests/sim.mjs` (13 headless) and `tests/sim-ui.mjs` (every CodeBot block, the
  starter project, the REPL, in the app).

- The CB3's own Python (botcore, botservices and their drivers, from Firia's CircuitPython
  fork) runs unchanged on a thin CircuitPython layer over MicroPython and a simulated board
  at the pin and bus level (David's direction, 2026-11-11: MicroPython in the browser, not
  CircuitPython; port only the CircuitPython pieces the device code and programs use).

- CodeX: its own codex.py, colors, codec, soundlib and songplayer, sprites and tile grids,
  on the same layer and a simulated board (IO expander, KXTJ3, LTR-303, the button ISR,
  backlight), with Firia's C graphics (bitmaps, canvases, the two-root tree, its 6x8 font
  from the firmware) and tone generator reimplemented. A flat face: screen, D-pad, A and B,
  LEDs, NeoPixels; full screen for a class with the arrow keys and A and B; tilt and light
  sliders; sound from the voices the program connects.

- CodeAIR in the gymnasium: its own codeair, flight, flightdb, recorder and cflib over a
  virtual Crazyflie and the arcade airframe (section 2); rangers, flow, IMU, barometer,
  magnetometer and state estimate from the room; NeoPixels, blue and status LEDs (an LP5009
  at its registers), buttons, speaker, battery; the figure leans, spins its propellers and
  lights its pixels. A stopped program gets 12 s of simulated time to clean up, so a stop
  inside `with recorder:` lands it, as on the drone.

- The radio between boards (section 1, "The device modules"): CodeX and CodeAIR, channels,
  on and off, RSSI and timestamp from `receive_full`; the boards page, with a CodeX remote
  and listeners to start from (`src/sim/boards/examples.js`); headless groups in lockstep.

- Line courses on the floor (`world/courses.js`): black 19 mm tape on a white mat, laid on
  any room's floor: an oval, a figure eight (its lines crossing square), the oval with a
  12 cm gap, and a T. Chosen from the simulator bar for CodeBot (or `course` headless); the
  robot starts on the line with its sensors over the tape. A follower built from the
  "line sensor sees a line" blocks goes round the three loops.

- Stepping by line: the ⤵ button in the simulator bar runs the program to its next line
  and pauses there (from a stop, it starts paused at the first line); the line is marked in
  the Python tab and on its block, and the status names it. The VM traces only main.py's
  frames, with a trace function in C (`_simtrace` in `simhook.c`), so no Python runs per line
  and simulated time is the same traced or not; `sim/runtime/py.patch` reports a line again
  on a jump back, so a loop of one line steps each turn. The app maps lines to blocks by
  generating the program once more with a marker before each statement
  (`generateWithLines`).

- Infrared between boards (`world/infrared.js`): the devices' own `infrared.py` on CodeX and
  CodeAIR runs unchanged over a `pulseio` stand-in (`python/common/pulseio.py`). A burst of
  pulses reaches every other board on the air once it has been sent, and the sender's own
  receiver, as on the device; range and aim are not modelled. CodeAIR's factory program
  (`xfly.py`, with its `selftest.py`) pairs with a CodeX remote by infrared and flies by
  radio; the simulated flight controller reports `supervisor.info` and a version that
  `selftest.check_firmware` finds current. The boards page has a remote for it among its
  examples (written here, speaking xfly's protocol).
- A performance budget for a low-end school Chromebook (`npm run perf`, sim/README.md
  "Performance"): lighter device models, a view that trades resolution for frame rate and
  rests when nothing moves, a smaller floor map; all within budget at 4x CPU with software
  GL. CI runs the simulator's tests in `npm test` and the budget as a report.
- Rooms (section 2, "Rooms"): the gymnasium, a classroom, the cafeteria and the auditorium,
  chosen from the simulator bar for CodeBot and CodeAIR (or `env` headless), each fetched
  only when chosen. In the auditorium a CodeBot starts on the stage facing the audience and
  can drive off it; a CodeAIR takes off from the stage. Left out of CodeSpace's models: the
  classroom's line arena of sign boards (shown only for CodeSpace's lessons), and an
  invisible rail in the auditorium from the stage over the seats.
- Without a mouse, and with a screen reader: every simulator control is reached by Tab
  with a visible focus ring, and named for a screen reader (the icon buttons, the sliders,
  CodeX's direction pad and buttons, its screen); a board's buttons are held with Space or
  Enter (`hold-button.js`); arrows and + and - move the 3D camera. The view is named and
  described in words (`describe.js`): room, place, facing, motion, lights and speaker,
  refreshed once a second, with changes that matter (moving, stopped, a bump, a fall,
  take-off, landing) announced politely. The strings stay in the simulator's files until
  the app's string table arrives. A guide for teachers: sim/TEACHERS.md.

Not yet: calibration.

Found by running CodeAIR's own Python (firia-circuitpython `codeair` at `752129a9f`), both
reproduced by the simulator because the device's VM behaves the same way, to confirm on a
real CodeAIR: `fly_high` cannot fly. `cflib/high_level_commander.py` never imports `crtp`,
so every command raises `NameError`; and `takeoff` and `land` pack with struct code `?`,
which neither CircuitPython nor MicroPython has (`ValueError: bad typecode`).

To check on a real CodeX: how `show()` scales and centres, how `print` wraps and scrolls,
how long a full-screen update takes, the order of LEDs 0 to 3 and of the NeoPixels.

To check on real infrared: how far apart and how aimed two boards still see each other
(here, always); the receiver's timing error (3% here); whether a CodeX sees its own emitter
as a CodeAIR does (here both do).

To check on real radios (CodeX or CodeAIR): the latency from `send` to `receive` (2 ms
here, `LATENCY_US`); how many messages the receive queue holds and which it drops when full
(32 here, the newest dropped); whether `off()` empties it; the longest message (none
enforced here; ESP-NOW carries 250 bytes); RSSI between boards on one desk (about -42 dBm
here, with a little noise); whether `send` with the radio off raises (silent here).

## HANDOFF (2026-11-12, from the rooms, accessibility and first push session)

**State.** Branch `sim` in `~/dev/firia/botblocks-sim` (a clone of firialabs/opencodebot),
pushed to origin and tracking `origin/sim` (2026-11-12, David: push and keep pushing as
the work goes). The SSH key on p52-lab is a read-only deploy key, so origin's push URL is
HTTPS, through `gh` (logged in as david-firia; its credential helper is in the global git
config): a plain `git push` works. CodeBot, CodeX and CodeAIR run in the app and headless,
in four rooms, with radio and infrared between boards, line courses, stepping by line, a
keyboard and screen-reader path, and a performance budget ("Where it stands"). All tests pass: `npm test` (the simulator's suites are in it, and so in CI) and
`npm run perf`. The manager has approved the design; assets are CC BY-NC 4.0 and may be
published; the devices' own Python may ship; CodeSpace's lesson content (its curriculum,
such as its CodeX remote for xfly) may not. Commits are authored as David
(`git -c user.name=... -c user.email=...`: this checkout has no identity configured).

**Working setup on p52-lab.** Emscripten in `~/.cache/emsdk`; MicroPython checkout in
`sim/build/micropython` (ignored); `sim/runtime/build.sh` rebuilds the VM (a few minutes)
and applies `port.patch` and `py.patch`. Firia's CircuitPython fork cloned (blobless) at
`~/dev/firia/firia-circuitpython`; CodeSpace's simulator at `~/dev/firia/botsim-ref`.
Playwright's own browser does not match the repo's pinned version here: use
`CHROME_PATH=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
`tests/smoke.mjs` and `tests/subpath.mjs` ignore `CHROME_PATH` and smoke uses port 4173
(not ours): run copies with `executablePath` added, smoke against your own `vite preview`
port through `OCB_URL`, subpath with `OCB_SUBPATH_PORT`. `tests/sim-ui.mjs` uses 4183,
`tests/perf.mjs` 4184. `npm run build` regenerates the models and rooms with the current
tools (use `npx vite build` alone to keep hand-built ones). Never `pkill -f` a pattern that
appears in the same command line (it kills the shell). Shell heredocs that mix quotes can
trip the harness's removal check: write files with Edit and Write.

**Things learned.** MicroPython's web port keeps its JS proxy tables on `globalThis`, so
two VMs in one realm corrupt each other; the browser gives each board a worker, and the
headless group swaps the globals (section 1). MicroPython's settrace reports a line only
when its number changes; `py.patch` adds a jump back. Playwright's `browser.newPage()`
makes a new context each time, which isolates `BroadcastChannel`: open tabs that should
hear each other from one `browser.newContext()`. The service worker answers a navigation
whose query string it does not ignore with `index.html`, so a page that takes a parameter
needs it in `ignoreURLParametersMatching` (vite.config.js). CAD models with per-face normals
cannot be simplified until the normals go (build-models.mjs `flat`). Chromium's CPU
throttling and SwiftShader make a pessimistic Chromebook; software GL is the bottleneck,
not the simulation (simulated time keeps up at 4x).

**This session learned.** CodeSpace's rooms carry impostors that no picture shows (the
auditorium's 2 cm rail from the stage over the seats): look at a room in the simulator,
not only at its numbers. A falling robot's body still overlaps the ledge it left, and
pushing it out of every box sends it a metre through the stage's stepped apron: land it
clear along its way. `npm run perf` frame rates swing with the machine's load (another
session compiling took CodeAIR from 24 to 14): compare against the previous commit back to
back before believing a miss. GitHub's runner measures 14 frames a second for both boards
(the report step, allowed to fail); the budget is set on p52-lab. CI runs only on pull
requests or by hand: `gh workflow run ci.yml --ref sim` ran the whole suite green
(2026-11-12).

**Next, in this order (the manager's order, 2026-11-12).**
0. Push after every commit (`git push`; see State).
1. Once David merges PR #2 (branch `feat/device-targets`, the device target interface:
   `docs/device-targets.md`, `src/device/device-target.js`), and before anything else:
   rebase `sim` onto origin/main and move SimDevice onto that interface
   (`registerDeviceKind('sim', ...)`, `?device=sim`; template
   `src/device/loopback-device.js`, test `tests/device.mjs`); the seam is
   `src/sim/device-switch.js`. Web Serial only, no WebUSB. `.github/workflows/ci.yml` will
   conflict: keep theirs (Playwright install with retries) and this branch's Node 24, job
   `timeout-minutes`, screenshot artifact and perf report step. The boards page builds on
   SimDevice directly, so it moves with it. Not merged on origin/main at `3c30484`.
2. (c) The simulator's own UI meets the app's accessibility and translation foundations:
   a keyboard for every control, labels for screen readers, every string in the app's
   string table. No string table exists yet on any pushed branch (checked 2026-11-11, after
   `d1ffeec`); read what the app worker merged once PR #2 lands and follow it. The
   simulator's strings are in `sim-panel.js`, `sim-device.js` (status messages and
   notices), `view/codex-face.js`, `boards.html`, `boards/boards.js` and
   `boards/examples.js` (the examples' comments are Python, and stay English unless the
   table says otherwise), and now `describe.js` (the screen reader's sentences) and
   `kinds.js` ROOMS. The keyboard, focus, labels and the text alternative are done
   (manager's go, 2026-11-11, before the rebase); what is left is moving their strings
   into the table, and the sentences in `describe.js` need the table's plurals and
   number formats.
3. (d) Done: the other rooms behind a room picker ("Where it stands", "Rooms"). The
   room picker's strings join step 2's list (`sim-panel.js`, and the room names in
   `kinds.js` ROOMS).
4. Done (2026-11-12): CodeBot calibrated to botsim, measured by running botsim's own
   physics headless ("Calibration"); `tests/sim.mjs` "drives as far and turns as fast as
   botsim" holds it there. Proposed next, while PR #2 waits (ask the manager): CodeAIR
   and CodeX against botsim the same way (`CodeAIRModels.js`, `CodeXModelController.js`),
   since CodeSpace's simulated FLY and CodeX lessons were tuned to them too.
5. Calibration on real devices (the lists in "Calibration", the radio and infrared lists
   in "Where it stands", and the Chromebook checks in sim/README.md "Performance").
