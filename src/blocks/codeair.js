/** CodeAIR drone: flying, lights, sound, buttons, battery. */
import { Order } from 'blockly/python'
import { msg, defineBlocks, value, numField, body } from './define.js'
import { need } from './context.js'

const MOVES = [
  [msg('block.opt.forward'), 'forward'],
  [msg('block.opt.backward'), 'back'],
  [msg('block.opt.left'), 'left'],
  [msg('block.opt.right'), 'right'],
  [msg('block.opt.up'), 'up'],
  [msg('block.opt.down'), 'down'],
]

const air = () => need('codeair', 'colors')
const flight = () => {
  air()
  need('flight')
}

defineBlocks([
  // ----------------------------------------------------------- flying
  {
    json: {
      type: 'codeair_safe_flight',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block, gen) => {
      flight()
      return `with recorder:\n${body(gen, block)}`
    },
  },
  {
    json: {
      type: 'codeair_take_off',
      args0: [{ type: 'field_number', name: 'HEIGHT', value: 0.4, min: 0.2, max: 2, precision: 0.1 }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block) => {
      flight()
      return `fly.take_off(${numField(block, 'HEIGHT', 0.4)})\n`
    },
  },
  {
    json: {
      type: 'codeair_land',
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: () => {
      flight()
      return 'fly.land()\n'
    },
  },
  {
    json: {
      type: 'codeair_move',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: MOVES },
        { type: 'field_number', name: 'DIST', value: 0.5, min: 0.1, max: 5, precision: 0.1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'DIST', 0.5)})\n`
    },
  },
  {
    json: {
      type: 'codeair_turn',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: [[msg('block.opt.left'), 'turn_left'], [msg('block.opt.right'), 'turn_right']] },
        { type: 'field_number', name: 'ANGLE', value: 90, min: 1, max: 360 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'ANGLE', 90)})\n`
    },
  },
  {
    json: {
      type: 'codeair_circle',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: [[msg('block.opt.left'), 'circle_left'], [msg('block.opt.right'), 'circle_right']] },
        { type: 'field_number', name: 'RADIUS', value: 0.5, min: 0.1, max: 3, precision: 0.1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'RADIUS', 0.5)})\n`
    },
  },
  {
    json: {
      type: 'codeair_hover',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block, gen) => {
      flight()
      return `fly.steady(${value(gen, block, 'SECS', '2')})\n`
    },
  },

  // ------------------------------------------------------------- lights
  {
    json: {
      type: 'codeair_pixel_set',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [
            [msg('block.opt.front_right_top_0'), '0'],
            [msg('block.opt.front_right_bottom_1'), '1'],
            [msg('block.opt.front_left_top_2'), '2'],
            [msg('block.opt.front_left_bottom_3'), '3'],
            [msg('block.opt.rear_left_bottom_4'), '4'],
            [msg('block.opt.rear_left_top_5'), '5'],
            [msg('block.opt.rear_right_top_6'), '6'],
            [msg('block.opt.rear_right_bottom_7'), '7'],
          ],
        },
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      air()
      return `pixels.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codeair_pixels_fill',
      args0: [
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      air()
      return `pixels.fill(${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codeair_pixels_off',
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: () => {
      air()
      return 'pixels.off()\n'
    },
  },
  {
    json: {
      type: 'codeair_led',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7']],
        },
        { type: 'input_value', name: 'BRIGHT', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      air()
      return `leds.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'BRIGHT', '255')})\n`
    },
  },
  {
    json: {
      type: 'codeair_status_led',
      args0: [{ type: 'input_value', name: 'BRIGHT', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      air()
      return `leds.set_status(${value(gen, block, 'BRIGHT', '255')})\n`
    },
  },

  // -------------------------------------------------------------- sound
  {
    json: {
      type: 'codeair_beep',
      args0: [
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'MS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: (block, gen) => {
      air()
      return `speaker.beep(${value(gen, block, 'FREQ', '440')}, ${value(gen, block, 'MS', '250')})\n`
    },
  },
  {
    json: {
      type: 'codeair_quiet',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: () => {
      air()
      return 'speaker.off()\n'
    },
  },

  // ------------------------------------------------------------ sensors
  {
    json: {
      type: 'codeair_button',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      air()
      return [`buttons.is_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_button_was',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      air()
      return [`buttons.was_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_battery',
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: () => {
      air()
      return ['power.battery_voltage()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_on_usb',
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: () => {
      air()
      return ['power.is_usb()', Order.FUNCTION_CALL]
    },
  },
])
