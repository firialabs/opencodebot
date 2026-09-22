# Contributing to OpenCodeBot

The whole point of this project is that a teacher can ask for a block and
somebody can add it that afternoon. Small contributions are very welcome.

## Getting set up

```bash
npm install
npm run dev
npm test        # before you open a pull request
```

There is no linter to fight with. Match the style of the file you are editing:
two-space indents, no semicolons, and comments that explain *why* rather than
restating the code.

## Adding a block

Everything about a block lives in one place: its shape and the Python it makes,
side by side. Open the file for the board — `src/blocks/codex.js`,
`codebot.js`, `codeair.js`, `radio.js`, or `basics.js` for blocks every board
shares — and add an entry:

```js
{
  json: {
    type: 'codex_vibrate',                     // unique, prefixed with the board
    message0: '📳 buzz for %1 seconds',        // %1 is the first argument
    args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
    previousStatement: null,                   // omit both for a value block,
    nextStatement: null,                       //   and add `output` instead
    style: 'sensors_blocks',                   // see src/blocks/theme.js
    tooltip: 'Plain-English help, written for a ten-year-old.',
  },
  python: (block, gen) => {
    codex()                                    // declares `from codex import *`
    return `buzzer.on(${value(gen, block, 'SECS', '1')})\n`
  },
}
```

Then add it to the right category in `src/blocks/toolbox.js`, giving any number
inputs a sensible default:

```js
block('codex_vibrate', { SECS: num(1) }),
```

That is it. `npm test` will build your block in a headless browser and check it
generates Python.

### Things worth knowing

- **Statement generators** return a string ending in `\n`. **Value generators**
  return `[code, Order.SOMETHING]` — `Order.FUNCTION_CALL` for a call,
  `Order.MEMBER` for an index, `Order.ATOMIC` for a literal.
- **Declare what you need** with `need(...)` rather than emitting an `import`
  line yourself. `src/blocks/generate.js` assembles the header in the order the
  firmware wants (on CodeX, `import radio` genuinely has to come first).
- **Check the real API** at [docs.firialabs.com](https://docs.firialabs.com/)
  before you write the Python. The boards differ in small ways — CodeX has
  `power.get_battery_voltage()` while CodeAIR has `power.battery_voltage()`.
- **Write the label like a sentence** a child would read aloud. "drive forward
  at 60% power", not "set motor velocity".
- **Emoji earn their place.** One at the start of a label helps a young or
  pre-literate student find a block. Two is clutter.

## Adding a whole new board

1. Add it to `src/device/targets.js` with its USB vendor and product ids and
   the regular expression that matches its boot banner.
2. Create `src/blocks/<board>.js` and import it from `src/blocks/index.js`.
3. Give it a toolbox and a starter project in `src/blocks/toolbox.js` and
   `src/workspace/workspace.js`.
4. If its firmware halts at a debug prompt on restart, add it to
   `DEBUGGER_TARGETS` in `src/device/device-manager.js`.

## Reporting a bug

Please say which board, which browser, and what the **Talk to device** tab
showed when it went wrong — that terminal output is usually the whole story.

## Code of conduct

Be kind. This project exists to make people feel capable, and that starts here.
