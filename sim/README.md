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
| `src/sim/world/` | the world, with no DOM and no renderer: clock, rooms, floor, the CodeBot model, maths and randomness |
| `src/sim/python/common/` | the CircuitPython layer over MicroPython: `board`, `digitalio`, `analogio`, `pwmio`, `busio`, `microcontroller`, `time` |
| `src/sim/python/<device>/` | the device's own Python modules, unchanged, and stand-ins for its C modules |
| `src/sim/bridge/` | each device's simulated board: its pins, ADC, PWM and bus chips, over the device's model; what each costs in device time |
| `src/sim/view/` | the Three.js picture, drawn from the world's snapshots |
| `src/sim/sim-device.js` | the simulator as a device, with the USB DeviceManager's face |
| `src/sim/device-switch.js` | the app's one device: the USB board or the simulator |
| `src/sim/sim-panel.js` | the Simulator tab: the view and its controls |
| `src/sim/headless.js` | run a program in Node, no browser: for tests and the cloud |
| `sim/runtime/` | the MicroPython variant (`variant/`), the port patch and `build.sh` |
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
(`cb3_drivers` on the CB3) get small Python stand-ins beside its modules.

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
stopping, pausing and the REPL. `tests/sim-ui.mjs` starts the simulator in the
built app in headless Chromium, runs every CodeBot block's Python, the starter
project with the Run button, and the REPL. If Playwright's own browser is
missing, point `CHROME_PATH` at an installed Chromium.

To run a program yourself, headless:

```js
import { runHeadless } from './src/sim/headless.js'
const r = await runHeadless({ source, env: 'gym', seconds: 10, seed: 1 })
// r.output, r.error, r.trace (pose every 50 ms), r.simSeconds, r.wallMs
```

## Adding a device

1. Its model in `src/sim/world/` (a class with `step(dt)` and `snapshot()`).
2. Its `_sim` module in `src/sim/bridge/`, with the device time each call costs.
3. Its Python modules in `src/sim/python/`, named and shaped as on the device.
4. A figure in `src/sim/view/`, and an entry in `src/sim/devices.js` and
   `src/sim/kinds.js`.
5. Tests in `tests/sim.mjs`.

## Adding a room

Add its GLB to `sim/assets/` (and to its LICENSE), and an entry in
`sim/tools/build-env.mjs` naming its floor layers and its physics boxes.
