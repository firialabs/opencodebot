# Third-party notices

OpenCodeBot's own code is under the MIT licence ([LICENSE](LICENSE)), and its artwork
and 3D models under CC BY-NC 4.0 (`sim/assets/LICENSE`). This file lists what the
repository and the built site carry from others, under their own terms. The built site
serves this file at `licenses/`, and the GPL's text with it when the build includes
CodeAIR flight.

## Committed in this repository

### MicroPython, as WebAssembly

- **Files:** `src/sim/runtime/mp/micropython.wasm` and `micropython.mjs`, the
  simulator's Python.
- **Built from:** MicroPython's webassembly port at commit `412a7e6`, with this
  repository's patches (`sim/runtime/port.patch`, `py.patch`) applied by
  `sim/runtime/build.sh`.
- **Emscripten:** built with Emscripten 7.0.0, whose runtime and C library are in the
  loader and the wasm; their notices follow MicroPython's.
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

### Emscripten's runtime and C library, in the MicroPython build

- **Files:** in `src/sim/runtime/mp/micropython.mjs` and `micropython.wasm`.
- **Built with:** Emscripten 7.0.0.
- **Licence:** Emscripten is under the MIT licence and the University of Illinois/NCSA
  Open Source License; its licence file, as Emscripten ships it:

```
Emscripten is available under 2 licenses, the MIT license and the
University of Illinois/NCSA Open Source License.

Both are permissive open source licenses, with little if any
practical difference between them.

The reason for offering both is that (1) the MIT license is
well-known, while (2) the University of Illinois/NCSA Open Source
License allows Emscripten's code to be integrated upstream into
LLVM, which uses that license, should the opportunity arise.

The full text of both licenses follows.

==============================================================================

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

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

==============================================================================

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.
All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal with the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

    Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimers.

    Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimers
    in the documentation and/or other materials provided with the
    distribution.

    Neither the names of Mozilla,
    nor the names of its contributors may be used to endorse
    or promote products derived from this Software without specific prior
    written permission. 

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS WITH THE SOFTWARE.

==============================================================================

This program uses portions of Node.js source code located in src/library_path.js,
in accordance with the terms of the MIT license. Node's license follows:

    """
        Copyright Joyent, Inc. and other Node contributors. All rights reserved.
        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software and associated documentation files (the "Software"), to
        deal in the Software without restriction, including without limitation the
        rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
        sell copies of the Software, and to permit persons to whom the Software is
        furnished to do so, subject to the following conditions:

        The above copyright notice and this permission notice shall be included in
        all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
        AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
        LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
        FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
        IN THE SOFTWARE.
    """

The musl libc project is bundled in this repo, and it has the MIT license, see
system/lib/libc/musl/COPYRIGHT

The third_party/ subdirectory contains code with other licenses. None of it is
used by default, but certain options use it (e.g., the optional closure compiler
flag will run closure compiler from third_party/).
```

- **musl libc**, Emscripten's C library, linked into the wasm: MIT.

```
musl as a whole is licensed under the following standard MIT license:

----------------------------------------------------------------------
Copyright © 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
----------------------------------------------------------------------
```

### CodeX's 6x8 font

- **Files:** `src/sim/world/fonts/codex6x8.js`, read from CodeX's firmware image by
  `sim/tools/extract-codex-font.mjs`.
- **Origin:** CodeX's firmware carries Adafruit GFX's classic 5x7 font (`glcdfont.c`),
  all but one glyph unchanged (`~` is redrawn).
- **Licence:** BSD, from the Adafruit GFX Library
  (<https://github.com/adafruit/Adafruit-GFX-Library>).

```
Software License Agreement (BSD License)

Copyright (c) 2012 Adafruit Industries.  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### CodeBot, CodeX and CodeAIR's own Python

- **Files:** `src/sim/python/`.
- **Copyright:** Firia Labs. These are the modules the boards carry in their firmware
  (`botcore`, `codex`, `codeair`, `flight` and their helpers), included so that
  programs run in the simulator as they do on a board.

<!-- flight -->
## Fetched at build time, in a build with CodeAIR flight

### The Crazyflie Python library (cflib), part of it

- **Not in this repository.** A build with CodeAIR flight (`SIM_FLIGHT=1`) fetches it
  from the repository and commit that `sim/flight-library.json` names, and bundles it
  into the built site. A build without it carries none of it.
- **Files:** `cflib/` (`commander.py`, `crtpstack.py`, `high_level_commander.py`,
  `motion_commander.py`, `position_hl_commander.py`), as CodeAIR's firmware carries them.
- **Copyright:** Bitcraze AB, with modifications by Firia, Inc., as each file's header
  says.
- **Why:** CodeAIR's own firmware carries these modules. The simulator runs them
  unchanged, so a student's flight program behaves as it does on the drone.
- **Licence:** GNU General Public License, version 2 or (at your option) any later
  version; the site serves its text at `licenses/GPL-2.0.txt`. These files stay under
  the GPL: the MIT licence does not cover them.
- **Source:** the repository and commit named in `sim/flight-library.json`{flight-source}.
  Bitcraze's originals are at <https://github.com/bitcraze/crazyflie-lib-python>.
<!-- /flight -->

## Bundled into the built site from npm

| Package | Licence |
| --- | --- |
| Blockly, `@blockly/block-plus-minus` | Apache-2.0 |
| Three.js | MIT |
| xterm.js, `@xterm/addon-fit` | MIT |
| Fredoka and Nunito fonts (`@fontsource-variable`) | SIL Open Font License 1.1 |

Each package's licence text is in its folder under `node_modules/` after `npm ci`.
