# LabBlocks simulator: design

A browser simulator of Firia Labs' devices inside LabBlocks: CodeBot in a
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
 | LabBlocks UI, editors       |  run,    | MicroPython (wasm, JSPI)             |
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

**CodeBot.** A 2D differential drive, modelled from the hardware: each wheel a DC
gearmotor (its torque falls linearly with speed from stall to no load) fed duty x battery
volts by the H-bridge, coasting at power 0; the battery sagging with the current; the
body's mass and turning inertia with the motors' rotors seen through the gears; the
gears' friction, the tyres' rolling resistance and the front skid's sliding as friction
that stops motion but never reverses it, which makes the deadband; the tyres' grip; the
body as a circle or oriented box against wall segments and prop shapes,
pushed out along the contact normal; when it is blocked, the wheels stall and the encoders
stop, as on the real robot. Constants from the CB3 itself: positions are measured from the
CB3's 3D model (the axle, the skid, the sensors; "Calibration" lists them), and the robot
rests tilted on its skid as the real one does.

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

## 5. Plugging into LabBlocks

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
under CC BY-NC 4.0 (its LICENSE). The derived files (merged meshes, world
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
4. LabBlocks: SimDevice, the connect choice, the view panel; blocks and Python editors run
   on the simulated CodeBot. Calibrate against a real CB3.
5. CodeX: `codex` shim, Canvas and Bitmap over a framebuffer, the screen panel, full screen
   with keyboard buttons.
6. CodeAIR: `codeair` and `flight` shims, the arcade flight model, its sensors.

## 9. Risks

- **JSPI outside Chromium.** Firefox and Safari fall back to the Asyncify build, about 5.7
  times slower but correct. Checked again before release.
- **Calibration.** CodeBot drives and reads lines as the physical CB3 should, from its
  hardware, not as CodeSpace's older simulated CodeBot does; a lesson tuned on that one may
  need its powers or times adjusted. Its assumptions ("Calibration" lists them), the
  per-bytecode time cost, CodeX and CodeAIR still need a bench. Until then those behave
  plausibly, not exactly.
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

- **CodeBot** (`CB3` in `src/sim/world/codebot.js`): the drive's and the line sensors'
  assumptions, listed below; the proximity beam's spread (its range table is measured);
  encoder signal levels; the accelerometer's axes and sign at rest. Sensor positions come
  from the CB3 model.
- **Device time** (`COST_US` in `src/sim/bridge/codebot.js`, `usPerBranch` in the engine):
  what a sensor read, a motor write and a bytecode cost on the device. A tight loop's
  iterations per second on a CB3 sets `usPerBranch`.

A bench session with a CB3, a tape line, a ruler and a stopwatch settles all of these,
in the final testing rounds. Until then CodeBot follows its hardware: what botcore does
with the pins is known exactly, the board is known from its published schematic (CodeBot
Mk 3 "CB3", Rev C, 2022-03-29, linked from Firia Labs' [CodeBot hardware
reference](https://docs.firialabs.com/codebot/hardware_reference/Schematic.html):
[PDF](https://docs.firialabs.com/_downloads/d1a72039afaa962e94f77357ed263519/codebot-cb3-SCH-RevC.pdf)),
the parts' datasheets are known, the gearmotors' numbers are the published typical ones
for the part, and the rest is assumed. The physical CB3 is the reference, not CodeSpace's older simulated
CodeBot, whose physics had quirks (a full-power spin slower than a half-power one).

**What is known** (from the schematic, botcore, the CB3's own module, and the docs):

- **Motor drive.** The H-bridge is a TB6612FNG (the schematic), its motor supply the
  battery's own rail, so the motors see the battery's voltage less the bridge's drop.
  `motors.run(n, power)` sets the motor's two direction pins on a PCA9557 I2C expander
  and its PWM duty to |power| %, at 1 kHz; `motors.enable()` drives the bridge's standby
  pin, which the bridge pulls down inside, so the motors are off until a program enables
  them. At power 0 both direction pins are low: the bridge lets go and the motor coasts.
  Between pulses at any other power the bridge shorts the motor (slow decay), so on
  average it sees duty x battery volts and can brake as well as drive. Its switches in
  the motor's path are 0.5 ohm together (`bridgeOhms`, the datasheet's typical, high and
  low switch, at a motor supply of 5 V or more). Not modelled: its 1.2 A average rating
  per channel, which a stalled TT motor (1.5 A) exceeds.
- **Battery.** Four AA cells, 6 V fresh (the docs). The battery reaches the board's rail
  through a reverse-polarity MOSFET and the power switch, which in its other position
  feeds the rail from USB instead. `system.pwr_volts()` reads the rail through a 107k over
  59k divider (the schematic, and botcore's `VOLTAGE_RATIO`), and the simulator's ADC
  channel is that divider's output.
- **Wheels and encoders.** 65 mm; track 111 mm. Each wheel's shaft carries a 20-slot
  disc read by a right-angle infrared emitter and phototransistor on the board, so an
  encoder counts 20 slots a turn of the wheel (`encoderSlots`), about 10 mm of travel a
  slot. The schematic names the pair (an APA3010F3C emitter at 20 mA, an APA3010P3BT
  phototransistor into a 1k load, so a slot reads high) and notes that at a top speed of
  10 revolutions a second the pulses come every 5 ms: 200 a second, which is 20 slots at
  10 turns of the wheel. The disc is on the wheel's shaft, not the motor's (through 48:1
  that would be 160 turns a second at the TT motor's 200 rpm), and 10 a second is the
  design's margin: the TT motor turns the wheel about 3.3 times a second, 0.6 m/s.
- **Gearmotors.** The yellow "TT" hobby gearmotor: plastic gears, 1:48, the output shaft
  through both sides of the gearbox.
- **Line sensors.** Five onsemi QRE1113GR reflective sensors, read through the ADC; 0 is
  brightest, 4095 darkest; botcore scales the CB3's 16-bit reading by 1.215 and shifts it
  to 12 bits, matched to a CB2 that read 4080 in the dark. The emitters are wired in
  series pairs from the battery (LS0 with LS3, LS1 with LS4, LS2 alone, in the
  schematic's numbering, which botcore reverses), each pair sunk by an STP16CPC26
  constant-current driver whose resistor sets 20 mA a pin, and each pair has two pins
  tied together. botcore's two bits a pair turn on one pin or both: 20 mA at power 1,
  40 mA at power 2 (the default), and only while it reads; lighting one sensor of a pair
  lights the other too. Each phototransistor's collector has a 47k pull-up to 3.3 V and
  goes straight to the ADC, so reflected light pulls the reading down, and 70 uA through
  47k pulls it all the way. From the QRE1113GR's datasheet: the emitter is infrared at 940 nm; the phototransistor's dark
  current is at most 100 nA, so with no light back it reads the pull-up's full voltage
  (`lineDark`); fully on, it holds at most 0.3 V, which through botcore's scaling is a
  floor of about 450 or less (`lineSaturated` is at or below it); its current rises with
  the emitter's, so half the emitter current gives about half the pull (the simulator's
  half span at power 1); over white paper (90%) its response peaks with the paper 0.6 mm
  away and falls to about 45% at 2 mm, 25% at 3 mm, 13% at 4 mm and 9% at 5 mm (the
  datasheet's Figure 2, at a 10 mA emitter, each of its two curves, white paper and a
  mirror, scaled to its own peak), so a drop off a table reads dark; and its on-state
  current, at a 20 mA emitter over an aluminium mirror 1 mm away, is 0.10 mA at least and
  0.90 mA typically, with no maximum given. The datasheet gives no absolute current over
  paper, so how far white pulls a reading down at the CB3's height is not in it; "Line
  sensor levels" below takes it from CodeSpace's simulator.
- **Geometry** (`CB3_BODY` in `src/sim/world/codebot.js`, measured from the CB3's 3D
  model, `sim/assets/BotBody.glb`, which matches the robot). The axle is the TT gearbox's
  output shaft: 35.5 mm behind the model's origin and 12.7 mm below the board's top face,
  at the gearbox's mid-height, 11 mm behind its front face. The tyres are 33.4 mm in
  radius (`WheelAssy.glb`). The robot has no caster: it rests on its wheels and on the
  battery holder's front bottom edge, a skid rounded to 5.7 mm, 39 mm ahead of the origin
  and 10 mm below the board. Resting on both, the board pitches nose down by 23.8°
  (`CB3_PITCH`), and the skid touches the floor 70 mm ahead of the axle (`skidAhead`).
  The line sensors sit on the board's underside, 59.5 mm ahead of the origin, 95 mm along
  the board from the axle; with the tilt they are 91 mm ahead of it on the floor, and
  their faces are 5.5 mm above it (measured on a CB3; the model puts the faces at 4.1 mm
  and the board's underside there at 5.0 mm: half a degree of tilt, which the tyres'
  give or the holder's edge could make). They look along the board's down direction, so
  tilted back 24°, and each sees the floor 2.4 mm behind the point under it: 88.5 mm
  ahead of the axle (`lineSensors`). The proximity sensors are 94 mm ahead of the axle.
  The collision circle runs from the board's front edge (96 mm ahead of the axle) to the
  motors' ends (49 mm behind it). The CB3's own side view shows the same: the nose down
  on the skid, the wheel's centre about 72 mm behind the skid's contact (70 here).

**Typical, unconfirmed**: the gearmotors' figures, published for the yellow 1:48 TT
motor at 6 V (Adafruit's product 3777, which gives the speed and torque as its
specification and the currents as measured on one motor; others publish similar
figures). They are the motor's at its own terminals, so the simulator's 6 V is four fresh
AA cells less the bridge's and battery's drops.

- **No-load speed** (`motorNoLoad`, 200 rpm, 20.9 rad/s): the specification's minimum,
  200 rpm ±10% at 6 V (one motor measured 250 rpm). On the robot, the top speed: 0.60 m/s
  here at 100%, fresh batteries.
- **Stall torque and current** (`motorStallTorque`, 0.8 kg cm, 0.078 N m;
  `motorStallAmps`, 1.5 A, so a 4 ohm winding).
- **No-load current** (`motorNoLoadAmps`, 0.16 A). Spinning free the motor draws only
  what its gears and brushes take, so this sets their friction: 0.009 N m at the wheel,
  about 12% of the stall torque. With the tyres' rolling resistance
  (`rollingResistance`, 2% of the load) and the skid's sliding it makes the deadband: here
  a robot on a hard floor starts to creep at about 17% power driving straight and 18%
  spinning. Confirm the lowest power that moves it, both ways.

**What is assumed**, each a point to confirm on a real CB3:

- **Inertia** (`wheelInertia`, `mass`, `yawInertia`). The rotor of a 130-size motor (the
  TT motor's size) seen through 48:1 (1.4e-4 kg m² a wheel), a 0.40 kg robot with
  batteries, 2.0e-3 kg m² about the axle. Together they set how fast it gets going: 63% of
  full speed in about 160 ms. Confirm the robot's weight, and its time to speed.
- **The battery's sag** (`batteryOhms`, 0.6 ohm, 0.15 a cell). It sags with the current,
  most at a stall; `system.pwr_volts()` reads the sagging value. Confirm with fresh and
  tired cells, and on NiMH (4.8 V), which slows everything about a fifth.
- **The floor** (`tyreGrip`, 0.8; `skidLoad`, 15% of the weight on the front skid;
  `skidFriction`, 0.25; where the skid touches, 70 mm ahead of the axle, is measured:
  "Geometry" above). The skid resists spinning
  more than driving straight, which is why a spin needs more power to start. The grip caps
  a wheel's push, so a full-power start is limited by it. Wheelspin is not modelled: a
  wheel turns only as the robot moves, so the encoders count the robot's motion.
- **Stopping.** Coasting at power 0 against friction alone: from full speed it rolls about
  15 cm. Confirm by cutting power at full speed and measuring.
- **Line sensor levels** (`lineDark`, 4080; `lineSaturated`, 150; `lineSpan`, 3850). The
  reading falls linearly with the floor's reflectance until the sensor saturates: the
  span is the phototransistor's current at full reflectance over the 70 uA that pulls the
  47k pull-up all the way, times the 3930 counts from dark to saturated. The span is
  CodeSpace's simulator's, the best evidence of the real robot there is: Firia tuned it
  to read close to a CB3. That simulator reads 4095 x (1 - g x (1 - d / 100 mm)), g the
  floor's colour (its sRGB channels averaged, as the floor maps here are built) and d the
  length of a ray down the board's tilted axis to the floor. Its robot rests about 20°
  nose down on a box for a skid, with d about 7 mm: white (g = 1) reads 286. At the
  CB3's geometry (5.5 mm, 24°: 6.0 mm along the axis) the same law gives a span of 3850,
  and that is `lineSpan`. So at full power: a perfect white reads about 230, white paper
  (0.85, the course mats) about 810, the gymnasium's painted lines (0.80) about 1000 and
  its wood (0.38 to 0.52) 2100 to 2600, black tape (0.04) about 3930, a drop 4080; each
  within 50 of CodeSpace's reading for the same floor. `ls.check()`'s default threshold,
  1000, falls between white paper and black tape, and so do botcore's default, 2500, and
  the older simulator's lessons' thresholds (2000 to 3300).
  **The datasheet agrees within its own uncertainty.** A span of 3850 means about 69 uA at
  full reflectance, 40 mA; over 90% paper at 20 mA, 5.5 mm, that is 31 uA, which on the
  datasheet's white-paper curve (8% of its peak at 5.5 mm, 88% at 1 mm) is 0.34 mA at
  1 mm. The datasheet gives no current over paper, only over a mirror (0.10 mA at least,
  0.90 typical); 0.34 mA over paper is 38% of a typical part's mirror figure and well
  above the minimum. An earlier version here guessed 0.3 mA over paper at 1 mm, read the
  datasheet's minimum and typical as a range over white card, and put the sensors 3 mm
  up: a span of 7700, with white saturating. The same guess at the measured 5.5 mm gives a
  span of 3400, 11% under CodeSpace's: white paper at about 1200 instead of 810. Two
  things the datasheet's curve does not cover push the real reading the other way: it is
  one sensor square over a reflector, while on the CB3 a sensor's neighbours, 9.7 mm away,
  light the same floor (lit in pairs and, for a read of all five, together), and at 5.5 mm
  each sees a wide patch of it. Where this departs from CodeSpace, it follows the board:
  the dark level is botcore's 4080, not 4095; at power 1 the emitters carry half the
  current, so the span halves (white paper then reads about 2440; CodeSpace ignores the
  power); each sensor averages a spot (below) rather than reading one ray; and the
  reading floors at the phototransistor's saturation, `lineSaturated`, 150 (0.1 V,
  inside the datasheet's 0.3 V most), which nothing paler than white reaches at this
  span. The floor map's visible reflectance stands in for 940 nm infrared, which can
  differ (some black tapes are bright in infrared). Confirm on a CB3: white paper, black
  tape, a room's floor and a drop on each of the five sensors at both powers. Each part's
  gain is not known (the datasheet gives only a minimum), so the five may spread; a white
  paper that reads near 1000 on one sensor would be the sign of a weak part.
- **The line sensor's spot** (`lineSpot`, 4 mm radius). Confirm by sliding a tape edge
  under one sensor and noting where the reading changes.
- **Not modelled.** The nose lifting as it starts hard (a moment of a higher sensor,
  reading paler floors darker); PWM ripple; motor-to-motor differences (a real pair drifts
  off straight); the CoM ahead of the axle in turns.

**Proximity** reads on: CodeSpace's real-robot lessons (Python with Robots, Hot Pursuit)
read it on a CB3, and its range table was measured on one.

**Lessons tuned on the older simulator.** It ran wheels at power x 15 rad/s with no
deadband (0.49 m/s at 100%, 10% still moving), stopped by a fixed 0.65 m/s² brake, and spun
119, 220 and 188 deg/s at 25, 50 and 100% (here: about 58, 248 and 613). A lesson that drove
at 10 to 15% now sits in the deadband, and one timed for a spin at full power turns about
three times as far. Its line sensors are the evidence for the levels here ("Line sensor
levels"): white reads 286 there and about 230 here, and its lessons' thresholds (2000,
2300, 3300) fall between white and black in both.

CodeAIR and CodeX have no older simulator to follow. CodeSpace's CodeAIR is the board's 3D model and
nothing more (no flight, sensors or physics), and its CodeX a model with buttons and no
sensor or output wired. CodeSpace's simulated lessons for them (14 in Python with CodeX, 3
in Lift-Off, 9 in Fly with Python, checked 2026-11-12) run no code: they are tours of the
model. Every lesson that programs them runs on the real board, so the real board is their
reference, and the lists below wait for the bench.

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
  at the pin and bus level (MicroPython in the browser, not CircuitPython; port only the
  CircuitPython pieces the device code and programs use).

- CodeX: its own codex.py, colors, codec, soundlib and songplayer, sprites and tile grids,
  on the same layer and a simulated board (IO expander, KXTJ3, LTR-303, the button ISR,
  backlight), with Firia's C graphics (bitmaps, canvases, the two-root tree, its 6x8 font
  from the firmware) and tone generator reimplemented. A flat face: screen, D-pad, A and B,
  LEDs, NeoPixels; full screen for a class with the arrow keys and A and B; tilt and light
  sliders; sound from the voices the program connects.

- CodeAIR in the gymnasium (in a build with CodeAIR flight, which fetches its cflib:
  `sim/README.md`, "CodeAIR flight"): its own codeair, flight, flightdb, recorder and cflib over a
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

Found by running CodeAIR's own Python (Firia's CircuitPython, `codeair` at `752129a9f`), both
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
