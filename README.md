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
| 🧭 **Starter projects** | Five or six short example programs for each board, easiest first, each with a goal. Open one from the ⋯ menu and change it. |

## No device? Simulate one

Press **🎮 Simulate** to run your program on a simulated CodeBot (it drives,
sees lines and walls, lights up and beeps), CodeX (its screen, buttons, lights
and sound; the screen goes full screen for a class, with the arrow keys and A
and B as its buttons) or, in a site built with CodeAIR flight, CodeAIR (it flies), in a gymnasium, a classroom, a
cafeteria or on an auditorium's stage. The terminal is a live Python prompt.
It runs in any modern browser, no cable needed. For teachers:
[sim/TEACHERS.md](sim/TEACHERS.md). How it works:
[sim/README.md](sim/README.md).

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

`npm test` runs every suite in `tests/`, none of which need hardware. Among them:

- **`tests/protocol.mjs`** — the debugger-output filter, and a round-trip of the
  file transfer through a real Python interpreter, byte-comparing what the
  device would have written against the original program.
- **`tests/smoke.mjs`** — builds every block in every toolbox in a headless
  browser and checks each one generates Python.
- **`tests/subpath.mjs`** — serves `dist/` from a sub-path the way GitHub Pages
  does, then pulls the network and reloads, so the "works offline" promise
  cannot quietly break.
- **`tests/privacy.mjs`**: walks the app (the palette, a run, the simulator in
  every room, the boards page) recording every request, from the page, its
  workers and its service worker, and fails on any that goes anywhere but the
  site the app came from. About promises nothing leaves the browser; this
  keeps that true.
- **`tests/examples.mjs`**: opens every starter project from the ⋯ menu, in
  English and Spanish, checks it is a tidy block program for its board with a
  goal, and runs its Python in the simulator.

### Hosting on GitHub Pages

`dist/` is a plain static bundle with a relative base path, so it works from the
root of a domain or from a sub-path such as
`https://firialabs.github.io/opencodebot/`.

`.github/workflows/deploy.yml` builds, tests and publishes it on every push to
`main`. Setting it up on a fresh fork takes two one-time steps:

1. Make the repository **public**. GitHub Pages cannot publish from a private
   repository unless the organisation is on GitHub Enterprise Cloud. Until it
   is, the deploy job skips quietly rather than failing red.
2. Turn Pages on under **Settings → Pages → Build and deployment → Source:
   GitHub Actions**. The workflow cannot do this for itself — creating a Pages
   site needs admin access and `GITHUB_TOKEN` only reaches write.

After that it is hands-off. There is no build step to configure, because Pages
serves a pre-built artifact rather than running Jekyll.

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
  i18n/        every string the app shows, one table per language
```

Running a program does what CodeSpace does: interrupt to a prompt, drop into the
raw REPL, write `main.py` a kilobyte at a time, then soft-reboot so the board
runs it. On boards whose firmware halts at a debug prompt, it then says "go".

## Strings and languages

Every string the app shows is in one table per language, in `src/i18n/`. English
(`en.js`) is the reference: every key is there first.

**Adding a string.** Give it a key in `en.js`, near the strings it sits with, and use
it with `t()`:

```js
import { t } from '../i18n/index.js'
toast({ title: t('saved.title'), detail: t('saved.detail', { file: name }) })
```

- **Placeholders** go in braces (`'Saved {file}.'`), and numbers in them are formatted
  for the language. `{app}` is always the product's name, which lives in one place,
  `app.name`.
- **Counts:** a string that depends on one is `{ one: '…', other: '…' }`, chosen by
  `{count}`. Join a list of names with `listOf()`.
- **HTML:** a key ending in `Html` holds HTML, and its placeholders are escaped.
- **The page's markup:** in `index.html`, mark an element with `data-i18n="key"` for its
  text, `data-i18n-html` for HTML, or `data-i18n-attr="title=key;aria-label=key"` for
  attributes.

**Blocks.** A block's words are in the table too, by its type: `block.<type>.message0`
(and `message1` and on, for a block with more lines) and `block.<type>.tooltip`. Leave
them out of the block's JSON in `src/blocks/`; `defineBlocks` fills them in through
Blockly's message system (`Blockly.Msg`, `%{BKY_...}`), as Blockly's own blocks do.
`%1`, `%2` mark where the block's inputs and fields go; a translation keeps every one
and may reorder them. A dropdown's labels use `msg()`:
`options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']]`. Example
values filled in on palette blocks are `sample.*` keys. Blockly's built-in blocks
(Logic, Loops, Math, Text, Lists, Variables, Functions) use Blockly's own translations,
picked in `src/blocks/locale.js`.

**Adding a language.** Copy `en.js` to `<code>.js` (say `fr.js`), translate the values
and leave the keys, then add it to `TABLES` in `src/i18n/index.js`, and Blockly's own
messages for it (`blockly/msg/fr`) to `src/blocks/locale.js`. A key the new table
leaves out falls back to English, so a partial translation works. The language comes
from `?lang=fr` in the address, then the one picked in the ⋯ menu (saved in the
browser), then the browser's own languages. Changing it reloads the page.

Spanish (`es.js`) is the first: a machine draft that needs a review by a native
speaker who teaches. Corrections are very welcome.

**Checking.** `npm run test:pseudo` runs the app in a pseudo-language, `?lang=en-XA`,
where every string from the table has its letters accented (`⟦Ŕûñ⟧`). Any plain letter
on screen, in a dialog, a menu, a block, a tooltip or a dropdown, is a string that
skipped the table, and the test names it. `tests/i18n.mjs` checks that every key the
code uses is in English, that every block has its words, and that each translation
keeps the English placeholders.

## Contributing

Yes please — especially new blocks. See [CONTRIBUTING.md](CONTRIBUTING.md); adding
a block is about fifteen lines in one file.

## Licence

This project uses three kinds of terms:

| What | Terms |
|---|---|
| **Code** (everything not listed below) | MIT. See [LICENSE](LICENSE). |
| **Artwork, 3D models and environments** (the simulator's assets live in `sim/assets/`, with their own `LICENSE`) | [Creative Commons Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (CC BY-NC 4.0) |
| **Firia Labs names, logos and the mascot** (including everything in `brand/` and the `firia-bot` icons in `public/icons/`) | Trademarks of Firia Labs. Neither licence above covers them. See [TRADEMARKS.md](TRADEMARKS.md). |
| **Others' code** the repository or the site carries: MicroPython (MIT); and, only in a site built with CodeAIR flight, part of Bitcraze's Crazyflie library as CodeAIR's firmware carries it, fetched at build time and not in the repository (**GPL-2.0-or-later**, not MIT; `sim/README.md`, "CodeAIR flight") | See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The built site serves the notices and licence texts at `licenses/`. |
