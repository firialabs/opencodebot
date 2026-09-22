/** Blocks every board shares: starting, waiting, repeating, printing. */
import { Order } from 'blockly/python'
import { defineBlocks, value, body } from './define.js'
import { need } from './context.js'

export const COLOR_CHOICES = [
  ['red', 'RED'],
  ['orange', 'ORANGE'],
  ['yellow', 'YELLOW'],
  ['green', 'GREEN'],
  ['dark green', 'DARK_GREEN'],
  ['cyan', 'CYAN'],
  ['blue', 'BLUE'],
  ['dark blue', 'DARK_BLUE'],
  ['purple', 'PURPLE'],
  ['magenta', 'MAGENTA'],
  ['pink', 'PINK'],
  ['brown', 'BROWN'],
  ['white', 'WHITE'],
  ['gray', 'GRAY'],
  ['off (black)', 'BLACK'],
]

defineBlocks([
  {
    json: {
      type: 'ocb_on_start',
      message0: '🟢 when program starts',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'start_hat',
      tooltip: 'These blocks run once, as soon as your program starts.',
      helpUrl: '',
    },
    python: (block, gen) =>
      // The body is written at top level, so peel off exactly one indent step.
      gen.statementToCode(block, 'DO').replace(new RegExp(`^${gen.INDENT}`, 'gm'), ''),
  },

  {
    json: {
      type: 'ocb_forever',
      message0: '🔁 forever',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'loop_hat',
      tooltip: 'These blocks repeat over and over, until you press Stop.',
    },
    python: (block, gen) => `while True:\n${body(gen, block)}`,
  },

  {
    json: {
      type: 'ocb_wait',
      message0: '⏳ wait %1 seconds',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
      tooltip: 'Pause before running the next block.',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'SECS', '1', Order.NONE)})\n`
    },
  },

  {
    json: {
      type: 'ocb_wait_ms',
      message0: '⏳ wait %1 milliseconds',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
      tooltip: 'Pause for a fraction of a second. 1000 milliseconds = 1 second.',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'MS', '100', Order.NONE)} / 1000)\n`
    },
  },

  {
    json: {
      type: 'ocb_print',
      message0: '💬 print %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
      tooltip: 'Show a message in the terminal on your computer.',
    },
    python: (block, gen) => `print(${value(gen, block, 'TEXT', "''", Order.NONE)})\n`,
  },

  {
    json: {
      type: 'ocb_color',
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'COLOR', options: COLOR_CHOICES }],
      output: null,
      style: 'lights_blocks',
      tooltip: 'A colour you can plug into lights and drawings.',
    },
    python: (block) => [block.getFieldValue('COLOR'), Order.ATOMIC],
  },

  {
    json: {
      type: 'ocb_rgb',
      message0: '🎨 red %1 green %2 blue %3',
      args0: [
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'G', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      inputsInline: true,
      output: null,
      style: 'lights_blocks',
      tooltip: 'Mix your own colour. Each value goes from 0 to 255.',
    },
    python: (block, gen) => {
      const r = value(gen, block, 'R', '0', Order.NONE)
      const g = value(gen, block, 'G', '0', Order.NONE)
      const b = value(gen, block, 'B', '0', Order.NONE)
      return [`(${r}, ${g}, ${b})`, Order.ATOMIC]
    },
  },

  {
    json: {
      type: 'ocb_seconds_since_start',
      message0: '⏱ seconds since start',
      output: 'Number',
      style: 'basics_blocks',
      tooltip: 'How long your program has been running.',
    },
    python: () => {
      need('time')
      return ['time.monotonic()', Order.FUNCTION_CALL]
    },
  },

  {
    json: {
      type: 'ocb_python',
      message0: '🐍 run Python %1',
      args0: [{ type: 'field_input', name: 'CODE', text: 'print("hi")' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
      tooltip: 'Escape hatch: write one line of Python yourself.',
    },
    python: (block) => `${block.getFieldValue('CODE')}\n`,
  },
])
