/** Blocks every board shares: starting, waiting, repeating, printing. */
import { Order } from 'blockly/python'
import { msg, defineBlocks, value, body } from './define.js'
import { need } from './context.js'

export const COLOR_CHOICES = [
  [msg('block.opt.red'), 'RED'],
  [msg('block.opt.orange'), 'ORANGE'],
  [msg('block.opt.yellow'), 'YELLOW'],
  [msg('block.opt.green'), 'GREEN'],
  [msg('block.opt.dark_green'), 'DARK_GREEN'],
  [msg('block.opt.cyan'), 'CYAN'],
  [msg('block.opt.blue'), 'BLUE'],
  [msg('block.opt.dark_blue'), 'DARK_BLUE'],
  [msg('block.opt.purple'), 'PURPLE'],
  [msg('block.opt.magenta'), 'MAGENTA'],
  [msg('block.opt.pink'), 'PINK'],
  [msg('block.opt.brown'), 'BROWN'],
  [msg('block.opt.white'), 'WHITE'],
  [msg('block.opt.gray'), 'GRAY'],
  [msg('block.opt.off_black'), 'BLACK'],
]

defineBlocks([
  {
    json: {
      type: 'ocb_on_start',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'start_hat',
      helpUrl: '',
    },
    python: (block, gen) =>
      // The body is written at top level, so peel off exactly one indent step.
      gen.statementToCode(block, 'DO').replace(new RegExp(`^${gen.INDENT}`, 'gm'), ''),
  },

  {
    json: {
      type: 'ocb_forever',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'loop_hat',
    },
    python: (block, gen) => `while True:\n${body(gen, block)}`,
  },

  {
    json: {
      type: 'ocb_wait',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'SECS', '1', Order.NONE)})\n`
    },
  },

  {
    json: {
      type: 'ocb_wait_ms',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'MS', '100', Order.NONE)} / 1000)\n`
    },
  },

  {
    json: {
      type: 'ocb_print',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
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
    },
    python: (block) => [block.getFieldValue('COLOR'), Order.ATOMIC],
  },

  {
    json: {
      type: 'ocb_rgb',
      args0: [
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'G', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      inputsInline: true,
      output: null,
      style: 'lights_blocks',
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
      output: 'Number',
      style: 'basics_blocks',
    },
    python: () => {
      need('time')
      return ['time.monotonic()', Order.FUNCTION_CALL]
    },
  },

  {
    json: {
      type: 'ocb_python',
      args0: [{ type: 'field_input', name: 'CODE', text: 'print("hi")' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block) => `${block.getFieldValue('CODE')}\n`,
  },
])
