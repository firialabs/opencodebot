# OpenCodeBot

**A light, friendly, block-based coding playground for Firia Labs hardware.**

OpenCodeBot lets a teacher plug in a **CodeBot**, **CodeX** or **CodeAIR**, snap
some blocks together, and press Run. No install, no accounts, no setup — just a
web page and a USB cable.

**▶ [Open OpenCodeBot](https://firialabs.github.io/opencodebot/)** — nothing to
install. Chrome or Edge on a computer or Chromebook.

It is a gentle on-ramp, not a replacement: everything it makes is real
CircuitPython, and the Python is always visible in a tab beside the blocks. When
a class is ready for the real thing, [CodeSpace](https://firialabs.com) is
waiting for them.

> Built with ❤️ for the many brilliant teachers who would like to try computer
> science but do not (yet) want to look at a text editor.

---

## What it does

| | |
|---|---|
| 🔌 **Plug and play** | Detects which board you plugged in and shows only the blocks it can actually run. |
| 🧩 **Friendly blocks** | Chunky, colourful, emoji-labelled blocks for screens, lights, motors, flight, sound, sensors and radio. |
| 🐍 **Real Python** | Every block maps to the documented [Firia Labs API](https://docs.firialabs.com/). Download the `.py` any time. |
| 💬 **A real terminal** | A full REPL to the device — tab completion, arrow-key history and colour all work, because bytes pass straight through. |
| ✈️ **Works offline** | Once the page has loaded it keeps working with no internet at all. Nothing is uploaded anywhere. |
| 💾 **Nothing to lose** | Your blocks are saved in the browser as you go, and can be saved to a file. |

## Supported devices

| Device | Connects over | Blocks for |
|---|---|---|
| **CodeBot CB3** | USB (`544d:cb03`) | driving, LEDs, line sensors, proximity, encoders, sound |
| **CodeX** | USB (`544d:c0de`) | 240×240 screen, neopixels, LEDs, tones and songs, buttons, tilt, light, radio |
| **CodeAIR** | USB (`544d:ca00`) | flight, neopixels, LEDs, beeps, buttons, battery, radio |

The original CodeBot CB2 is recognised but cannot be used: its USB interface is
not one a browser can open.

## Browser support

OpenCodeBot talks to hardware through the
[Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API), so
you need **Chrome, Edge or another Chromium browser on a desktop or
Chromebook**, served over `https://` (or `http://localhost` while developing).
Safari and Firefox can still build blocks and download the Python — they just
cannot connect to a device.

## Running it yourself

```bash
npm install
npm run dev      # http://localhost:5173
```

To build the static site (it is just files — host it anywhere that serves
HTTPS):

```bash
npm run build    # writes dist/
npm run preview  # serve dist/ locally
```

`npm test` runs three suites, none of which need hardware:

- **`tests/protocol.mjs`** — the debugger-output filter, and a round-trip of the
  file transfer through a real Python interpreter, byte-comparing what the
  device would have written against the original program.
- **`tests/smoke.mjs`** — builds every block in every toolbox in a headless
  browser and checks each one generates Python.
- **`tests/subpath.mjs`** — serves `dist/` from a sub-path the way GitHub Pages
  does, then pulls the network and reloads, so the "works offline" promise
  cannot quietly break.

### Hosting on GitHub Pages

`dist/` is a plain static bundle with a relative base path, so it works from the
root of a domain or from a sub-path such as
`https://firialabs.github.io/opencodebot/`.

`.github/workflows/deploy.yml` builds, tests and publishes it on every push to
`main`. It needs the repository to be **public** — GitHub Pages cannot publish
from a private repository unless the organisation is on GitHub Enterprise Cloud
— and skips quietly rather than failing red until it is.

Nothing needs enabling by hand: the workflow switches Pages on itself the first
time it runs. There is no separate build step to configure, because Pages is
serving a pre-built artifact rather than running Jekyll.

Hosting it somewhere else is just as easy — copy `dist/` onto any HTTPS host.
Web Serial needs a secure context, so `https://` (or `http://localhost`) is
required; a site served over plain `http://` will load but will not connect to
a device.

## How it works

```
src/
  device/      talking to the board
    targets.js         which boards exist, and their USB ids
    serial-link.js     Web Serial: open, read, write, notice unplugs
    repl.js            the raw REPL: send a command, write a file
    console-filter.js  strips the debugger's out-of-band bytes
    device-manager.js  connect → detect → load → run → stop, as events
  blocks/      the blocks and the Python they make
    basics.js, codex.js, codebot.js, codeair.js, radio.js
    toolbox.js         what each board's toolbox contains
    generate.js        assembles imports and setup around the block code
    theme.js           colours and shapes
  workspace/   the Blockly workspace, saving and starter projects
  ui/          terminal, toasts, dialogs and the app shell
```

Running a program does what CodeSpace does: interrupt to a prompt, drop into the
raw REPL, write `main.py` a kilobyte at a time, then soft-reboot so the board
runs it. On boards whose firmware halts at a debug prompt, it then says "go".

## Contributing

Yes please — especially new blocks. See [CONTRIBUTING.md](CONTRIBUTING.md); adding
a block is about fifteen lines in one file.

## Licence

MIT. See [LICENSE](LICENSE).

Firia Labs, CodeBot, CodeX, CodeAIR and CodeSpace are trademarks of Firia Labs.
