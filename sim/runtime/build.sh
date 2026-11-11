#!/usr/bin/env bash
# Builds the simulator's MicroPython (WebAssembly, JSPI) into src/sim/runtime/mp/.
#
# The output is committed, so building the app needs no Emscripten. Run this
# only when the variant (sim/runtime/variant/), the port or py patch or the pinned
# MicroPython commit changes.
#
# Needs: git, make, python3, and Emscripten. EMSDK points at an emsdk checkout
# (default ~/.cache/emsdk); one is installed there if missing.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
MP_COMMIT=412a7e6b651ac2d7c9168aa07cfebed77528724a
SRC=$ROOT/sim/build/micropython
EMSDK=${EMSDK:-$HOME/.cache/emsdk}
OUT=$ROOT/src/sim/runtime/mp

if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK"
  (cd "$EMSDK" && ./emsdk install latest && ./emsdk activate latest)
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

if [ ! -d "$SRC/.git" ]; then
  git clone https://github.com/micropython/micropython.git "$SRC"
fi
cd "$SRC"
if [ "$(git rev-parse HEAD)" != "$MP_COMMIT" ]; then
  git fetch origin && git checkout -q "$MP_COMMIT"
fi
git checkout -q -- ports/webassembly py
git apply "$HERE/port.patch"
# A jump back reports its line again (a loop of one line), for stepping by line.
git apply "$HERE/py.patch"
rm -rf ports/webassembly/variants/sim
cp -r "$HERE/variant" ports/webassembly/variants/sim

rm -rf ports/webassembly/build-sim   # the frozen manifest is not tracked as a dependency
make -s -C mpy-cross -j8
make -s -C ports/webassembly submodules
make -s -C ports/webassembly VARIANT=sim -j8
make -s -C ports/webassembly VARIANT=sim min

mkdir -p "$OUT"
cp ports/webassembly/build-sim/micropython.min.mjs "$OUT/micropython.mjs"
cp ports/webassembly/build-sim/micropython.wasm "$OUT/micropython.wasm"
ls -l "$OUT"
