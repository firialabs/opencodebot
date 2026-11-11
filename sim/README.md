# The simulator

A simulated Firia Labs device in the browser: the student's program runs on
MicroPython (WebAssembly) against a model of the device in a room, on
simulated time. Why it is built this way is in [DESIGN.md](DESIGN.md).

## Where things are

| | |
|---|---|
| `src/sim/runtime/engine.js` | MicroPython on simulated time: charging, pacing, pause, step, stop, the REPL |
| `src/sim/runtime/worker.js` | the Web Worker: world and engine together; the page's commands in, frames out |
| `src/sim/runtime/mp/` | the built MicroPython (committed; rebuilt by `npm run sim:runtime`) |
| `src/sim/world/` | the world, with no DOM and no renderer: clock, rooms (`environment.js`: boxes, cylinders, raised floors), floor, line courses (`courses.js`), the CodeBot, CodeX and CodeAIR models, CodeX's screen and graphics (`screen.js`, `gfx.js`, its font), CodeAIR's flight controller (`crazyflie.js`), maths and randomness |
| `src/sim/python/common/` | the CircuitPython layer over MicroPython: `board`, `digitalio`, `analogio`, `pwmio`, `busio`, `microcontroller`, `time`, and Adafruit's `neopixel` |
| `src/sim/python/radio/` | the radio module CodeX and CodeAIR share; under it `world/radio.js` (a board's radio), `world/infrared.js` (its infrared, under `python/common/pulseio.py`), `runtime/broadcast-air.js` (between workers and tabs) and `runtime/lockstep.js` (headless groups) |
| `src/sim/python/<device>/` | the device's own Python modules, unchanged, and stand-ins for its C modules; `src/sim/kinds.js` says which folders each device runs, and lists the rooms |
| `src/sim/bridge/` | each device's simulated board: its pins, ADC, PWM and bus chips, over the device's model; what each costs in device time |
| `src/sim/view/` | the pictures: Three.js for the room (`view.js`) with CodeBot and CodeAIR in it (`codebot-figure.js`, `codeair-figure.js`), a flat face for CodeX (`codex-face.js`) |
| `src/sim/sim-device.js` | the simulator as a device, with the USB DeviceManager's face |
| `src/sim/device-switch.js` | the app's one device: the USB board or the simulator |
| `src/sim/sim-panel.js` | the Simulator tab: the view and its controls |
| `src/sim/headless.js` | run a program in Node, no browser: for tests and the cloud; `runHeadlessGroup` runs several boards at once, radios linked |
| `boards.html`, `src/sim/boards/` | the boards page: several simulated boards, each with its own program, and the radio examples they start with |
| `sim/runtime/` | the MicroPython variant (`variant/`, with the line trace for stepping), the port patch, a one-hunk `py.patch` (a jump back reports its line again) and `build.sh` |
| `sim/tools/` | turn the source GLBs into what the browser and the world load |
| `sim/assets/` | the source models and rooms (CC BY-NC 4.0, see its LICENSE) |

## The device's own Python

The simulator runs each device's own frozen Python modules, unchanged, so a
program meets the same `botcore` (and its bugs and timing) as on the device.
They come from Firia's CircuitPython fork, `git@bitbucket.org:firia/firia-circuitpython.git`:

| Device | Branch | Commit | Path |
|---|---|---|---|
| CodeBot CB3 | `codex` | `4d3064021` (2025-04-04) | `ports/esp32s2/boards/cb3/frozen/general/` |
| CodeX | `codex` | `4d3064021` (2025-04-04) | `ports/esp32s2/boards/codex_mk1/frozen/` |
| CodeAIR | `codeair` | `752129a9f` (2026-11-05) | `ports/espressif/boards/codeair/frozen/` |

Under them is a thin CircuitPython layer over MicroPython (`python/common/`):
only what the device code and students' programs use, nothing more. Under
that, each device's simulated board (`src/sim/bridge/`) answers at the level
the device code drives the hardware: a pin's level, an ADC channel, a PWM
duty and frequency, an I2C register, an SPI write. A device's C modules
get small Python stand-ins beside its modules: `cb3_drivers` on the CB3;
`bitmap`, `canvas`, `tft`, `codex_drivers` (with `funcgen`), `radio` and the
CircuitPython audio modules on CodeX; `crtp`, `codeair_drivers`, `img_utils`,
`stm_fw` and CircuitPython's `espcamera` (sees nothing), `sdcardio` and
`storage` (no card), `supervisor` and `traceback` on CodeAIR. Adafruit's
`neopixel` is replaced by a small equivalent.

CodeAIR's flight controller is not Python: the device's `crtp` module talks
over a UART to an STM32 running Crazyflie firmware. Here `crtp` reaches a
simulated Crazyflie (`world/crazyflie.js`) that decodes the same packets, with
the tables of contents from the device's own `flight_catalog.py`. The MicroPython build stores no docstrings, as the devices'
CircuitPython does not, because Firia's modules test for `__doc__`.

CodeX's font is its own, read from its firmware image by
`sim/tools/extract-codex-font.mjs`.

To update them, copy the files from a newer commit and change the table.

## Building

```bash
npm run build          # makes the simulator's rooms and models, then the site
npm run sim:assets     # just the rooms and models, into public/sim-assets/
npm run sim:runtime    # rebuild MicroPython (needs Emscripten; see sim/runtime/build.sh)
```

The MicroPython build only matters when `sim/runtime/` changes: its output is
committed, so building the site needs no Emscripten. Node 24 or later (JSPI).

## Testing

```bash
npm run test:sim       # headless programs (tests/sim.mjs), then the simulator in the app (tests/sim-ui.mjs)
```

`tests/sim.mjs` runs real programs against the world in Node, far faster than
real time, and checks timing, driving, walls, sensors, determinism, errors,
stopping, pausing, the REPL and the radio between boards. `tests/sim-ui.mjs`
starts the simulator in the built app in headless Chromium, runs every block's
Python on its device, the starter project with the Run button and the REPL,
flies CodeAIR, and has a CodeX remote on the boards page reach a CodeAIR there
and the app's CodeX in another tab. If Playwright's own browser is
missing, point `CHROME_PATH` at an installed Chromium.

CI runs both, in `npm test`, on every pull request and before every deploy
(`.github/workflows/`): about 1.5 minutes here, under 3 with every core
busy. The UI test waits on what the boards do, not on the clock, so a slow
runner only makes it slower. When it fails, its screenshots are kept as the
run's `test-screenshots` artifact.

To run a program yourself, headless:

```js
import { runHeadless } from './src/sim/headless.js'
const r = await runHeadless({ source, env: 'gym', seconds: 10, seed: 1 })
// r.output, r.error, r.trace (pose every 50 ms), r.simSeconds, r.wallMs
```

On a line course (`oval`, `eight`, `gap`, `tee`; `world/courses.js`), the robot
starting on it: `runHeadless({ source, course: 'oval', env: 'gym' })`. The rooms are
`gym`, `classroom`, `cafeteria` and `auditorium` (on its stage), and `empty`, a 4 m
square with nothing in it.

Several boards at once, their radios linked, on one timeline (the same run every time):

```js
import { runHeadlessGroup } from './src/sim/headless.js'
const { results } = await runHeadlessGroup({ seconds: 5, devices: [
  { kind: 'codex', source: remote, inputs: [{ t: 1, fn: (w, d) => d.press(4, true) }] },
  { kind: 'codeair', source: listener },
] })
// results[i] as runHeadless returns
```

## The boards page

`boards.html` (the "📡 More boards" link in the simulator bar, for CodeX and CodeAIR) shows
several simulated boards, each with its own Python, picture and terminal, and examples to
start from (among them CodeAIR's factory program and a CodeX remote that pairs with it by
infrared). Every board runs in its own worker, and their radios and infrared reach each
other, and the app's board in another tab of the same browser. `?boards=codex,codeair` starts with those boards; otherwise
the page remembers its boards and programs in this browser.

## Performance

`npm run perf` (after a build) checks the budget for a low-end school
Chromebook, roughly: the page's CPU throttled 4x and software GL, which is
slower than any real GPU. CI runs it as a report. On p52-lab (2026-11-11):

| | Budget | CodeBot | CodeAIR |
|---|---|---|---|
| First visit, gzip | 600 KB | 398 KB | 398 KB |
| First visit, to load | 3 s | 0.9 s | 0.9 s |
| Simulator start, gzip | 1,400 KB | 1,238 KB | 1,311 KB |
| Simulator start, to ready | 5 s | 1.8 s | 1.7 s |
| Frames a second in the gym, moving | 20 | 25 | 24 |
| Simulated time per wall second | 0.95 | 0.97 | 1.00 |

What keeps it there:
- The device models are built for it (`sim/tools/build-models.mjs`): plain
  colours share a palette texture (CodeAIR 63 draw calls to 10, CodeBot 25
  to 6), meshes simplified (CodeAIR 85k triangles to 36k, its smallest board
  parts dropped; CodeBot 22k to 12k), textures at most 1024 px.
- The view lowers its resolution, to half at most, when it draws fewer than
  24 frames a second, and raises it again above 50 (`SimView._govern`). It
  stops drawing when nothing has moved for 1.5 s.
- The room's floor map is lossless WebP (118 KB, was a 373 KB PNG).

After the first visit the service worker fetches the rest of the site in
the background, about 2 MB gzip (1.4 MB of it the simulator), so the
simulator works offline after that, in the gymnasium. The other rooms
(0.8 to 1.5 MB each) are fetched only when chosen, and kept from then on.

To check on a real Chromebook: the frame rate and resolution the view
settles at, and the first visit on a school network.

## Adding a device

1. Its model in `src/sim/world/` (a class with `step(dt)` and `snapshot()`).
2. Its `_sim` module in `src/sim/bridge/`, with the device time each call costs.
3. Its Python modules in `src/sim/python/`, named and shaped as on the device.
4. A figure in `src/sim/view/`, and an entry in `src/sim/devices.js` and
   `src/sim/kinds.js`.
5. Tests in `tests/sim.mjs`.

## Adding a line course

Add it to `COURSES` in `src/sim/world/courses.js`: a name, the mat (a rectangle in
metres around the origin), the tape as polylines, and a spawn on the line
(`spawnAlong` puts the line sensors over the tape). Each room lays it at its own
`courseAt`. The simulator's course picker and `runHeadless({ course })` list it
from there. Add a follower test to `tests/sim.mjs`; the rooms test checks that
every course lies on clear floor in every room.

## Adding a room

Add its GLB to `sim/assets/` (and to its LICENSE), an entry in
`sim/tools/build-env.mjs` (its floor layers, the faces too high to be floor, its
physics impostors, what to leave out, its start and where courses go), a name in
`ROOMS` in `src/sim/kinds.js`, and its build to `sim:assets` in package.json.
CodeSpace's start positions are Babylon's: its z is the glTF z, and its x the
glTF x mirrored. `tests/sim.mjs` then checks its start and courses are on clear
floor; look at it from the simulator before trusting it (an impostor may stand
for something no picture shows).
