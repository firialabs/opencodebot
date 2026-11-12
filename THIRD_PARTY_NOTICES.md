# Third-party notices

OpenCodeBot's own code is under the MIT licence ([LICENSE](LICENSE)), and its artwork
and 3D models under CC BY-NC 4.0 (`sim/assets/LICENSE`). This file lists what the
repository and the built site carry from others, under their own terms. The built site
serves this file and the GPL text at `licenses/`.

## Committed in this repository

### MicroPython, as WebAssembly

- **Files:** `src/sim/runtime/mp/micropython.wasm` and `micropython.mjs`, the
  simulator's Python.
- **Built from:** MicroPython's webassembly port at commit `412a7e6`, with this
  repository's patches (`sim/runtime/port.patch`, `py.patch`) applied by
  `sim/runtime/build.sh`.
- **Emscripten:** the loader includes Emscripten's runtime, which is under the MIT
  licence (and the University of Illinois/NCSA licence).
- **Licence:** MIT.

```
The MIT License (MIT)

Copyright (c) 2013-2026 Damien P. George

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### The Crazyflie Python library (cflib), part of it

- **Files:** `src/sim/python/codeair/cflib/` (`commander.py`, `crtpstack.py`,
  `high_level_commander.py`, `motion_commander.py`, `position_hl_commander.py`).
- **Copyright:** Bitcraze AB, with modifications by Firia, Inc., as each file's header
  says.
- **Why it is here:** CodeAIR's own firmware carries these modules. The simulator runs
  them unchanged, so a student's flight program behaves as it does on the drone.
- **Licence:** GNU General Public License, version 2 or (at your option) any later
  version. The full text is `src/sim/python/codeair/cflib/COPYING`. These files stay
  under the GPL: the MIT licence does not cover them.
- **Source:** these files are their own source. The originals are at
  <https://github.com/bitcraze/crazyflie-lib-python>.

### CodeBot, CodeX and CodeAIR's own Python

- **Files:** the rest of `src/sim/python/`.
- **Copyright:** Firia Labs. These are the modules the boards carry in their firmware
  (`botcore`, `codex`, `codeair`, `flight` and their helpers), included so that
  programs run in the simulator as they do on a board.

## Bundled into the built site from npm

| Package | Licence |
| --- | --- |
| Blockly, `@blockly/block-plus-minus` | Apache-2.0 |
| Three.js | MIT |
| xterm.js, `@xterm/addon-fit` | MIT |
| Fredoka and Nunito fonts (`@fontsource-variable`) | SIL Open Font License 1.1 |

Each package's licence text is in its folder under `node_modules/` after `npm ci`.
