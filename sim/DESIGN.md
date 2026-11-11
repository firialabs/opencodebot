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

**CodeBot.** A 2D differential drive. Motor power to target wheel speed through a deadband,
battery scaling and a first-order lag (about 80 ms); wheel acceleration clamped to a traction
limit (slip); the body as a circle or oriented box against wall segments and prop shapes,
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

The device and room GLBs come from CodeSpace's simulator. They are not committed until David
agrees to publish them: `sim/assets/` is in `.gitignore`, and the build reads them from
there. The derived files (merged meshes, world JSON, reflectance maps) are generated, also
ignored, and published with the assets when that is agreed. Only the gymnasium at first.

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
- **Calibration.** Drive lag, traction, the per-bytecode time cost and the sensor curves need
  a real CB3, CodeX and CodeAIR on a bench. Until then the simulator behaves plausibly, not
  exactly.
- **The device's own Python sources.** The frozen Firia modules would run unchanged if their
  sources can ship in the simulator build; if they are not open, the shims reimplement them
  from the docs.
- **Patch upkeep.** The variant changes about 170 lines of MicroPython's port and is rebased
  on upstream releases.
- **Assets** wait on David's agreement to publish them.

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

A bench session with a CB3, a tape line and a ruler settles all of these.

- **CodeAIR** (`AIR` in `src/sim/world/codeair.js`, constants in `crazyflie.js`): how
  closely it tracks a velocity, height and yaw rate (the lags and gains); how far it drifts
  in a hover, high and near the floor; how it bounces off a wall; how far above the floor
  `land()` cuts the motors; what a ranger reports with nothing in range (32767 here); the
  flow sensor's sign and scale; which way roll and pitch are signed in the log; how many log
  packets the `crtp` module queues (two here, so `get_data` is at most one period stale);
  the battery's voltage in flight. Positions of the LEDs and NeoPixels on the figure are
  from the board's silkscreen.

## Where it stands

Built, on branch `sim` (local commits; pushing waits for David):

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

## HANDOFF (2026-11-11, from the radio session)

**State.** Branch `sim` in `~/dev/firia/botblocks-sim` (a clone of firialabs/opencodebot),
local commits only (last `e6d7154` before this handoff); nothing is pushed: pushing to the
public repository waits for David's own go, typed in the session. CodeBot, CodeX and
CodeAIR run in the app and headless, and the radio works between boards (section 1, "The
device modules"; the boards page, `boards.html`). All tests pass: `npm run test:sim` with
`CHROME_PATH` set (see below), and the app's smoke, subpath and protocol tests. The manager
has approved the design; assets are CC BY-NC 4.0 and may be published; the devices' own
Python may ship. Commits are authored as David (`git -c user.name=... -c user.email=...`:
this checkout has no identity configured).

**Working setup on p52-lab.** Emscripten in `~/.cache/emsdk`; MicroPython checkout in
`sim/build/micropython` (ignored); Firia's CircuitPython fork cloned (blobless) at
`~/dev/firia/firia-circuitpython`; CodeSpace's simulator at `~/dev/firia/botsim-ref` (its
firmware images hold the CodeX font; `models/CodeAIR/TopPcb.jpg` shows the drone's board).
Playwright's own browser does not match the repo's pinned version here: use
`CHROME_PATH=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
`tests/smoke.mjs` and `tests/subpath.mjs` ignore `CHROME_PATH` and smoke uses port 4173
(not ours): run copies with `executablePath` added, smoke against your own `vite preview`
port through `OCB_URL`, subpath with `OCB_SUBPATH_PORT`. `tests/sim-ui.mjs` uses 4183.
Never `pkill -f` a pattern that appears in the same command line (it kills the shell).

**Things learned.** MicroPython's web port keeps its JS proxy tables on `globalThis`, so
two VMs in one realm corrupt each other; the browser gives each board a worker, and the
headless group swaps the globals (section 1). Playwright's `browser.newPage()` makes a new
context each time, which isolates `BroadcastChannel`: open tabs that should hear each other
from one `browser.newContext()`. The service worker answers a navigation whose query string
it does not ignore with `index.html` (the fallback), so a page that takes a parameter needs
it in `ignoreURLParametersMatching` (vite.config.js). `for _ in range(x)` takes a float on
the devices' VMs (an inline loop), `range(10.0)` elsewhere raises. The CodeAIR figure's
model is in metres, front +z, left +x. The CodeAIR finding in "Where it stands" is with the
manager; the simulator keeps the device's code unchanged.

Line courses, stepping by line and infrared are done ("Where it stands"). CodeSpace's own
CodeX remote for xfly (`botsim-ref/public/lesson-content/objective-files/CodeXair_code`)
also pairs and flies here; it is lesson content, so it is not in this repository.

**Next, in this order (the manager's order, 2026-11-11).**
1. Once David merges PR #2 (branch `feat/device-targets`, the device target interface:
   `docs/device-targets.md`, `src/device/device-target.js`), rebase `sim` onto origin/main
   and move SimDevice onto that interface (`registerDeviceKind('sim', ...)`, `?device=sim`;
   template `src/device/loopback-device.js`, test `tests/device.mjs`); the seam is
   `src/sim/device-switch.js`. The repo has Web Serial only, no WebUSB. Keep this branch's
   Node 24 CI change alongside theirs (Playwright install with retries). Not merged on
   origin/main at `3c30484` (checked 2026-11-11). The boards page builds on SimDevice
   directly, so it moves with it.
2. Calibration on real devices (the lists in "Calibration" and the radio list in "Where it
   stands").
