/** CodeBot CB3: driving, lights, line and proximity sensors, sound. */
import { Order } from 'blockly/python'
import { msg, defineBlocks, value } from './define.js'
import { need } from './context.js'

const DIRECTIONS = [
  [msg('block.opt.forward'), 'forward'],
  [msg('block.opt.backward'), 'backward'],
  [msg('block.opt.turn_left'), 'left'],
  [msg('block.opt.turn_right'), 'right'],
]

const SIDES = [
  [msg('block.opt.left'), 'LEFT'],
  [msg('block.opt.right'), 'RIGHT'],
]

const LINE_SENSORS = [
  [msg('block.opt.far_left_0'), '0'],
  [msg('block.opt.left_1'), '1'],
  [msg('block.opt.middle_2'), '2'],
  [msg('block.opt.right_3'), '3'],
  [msg('block.opt.far_right_4'), '4'],
]

const AXES = [
  [msg('block.opt.side_to_side_x'), '0'],
  [msg('block.opt.front_to_back_y'), '1'],
  [msg('block.opt.up_and_down_z'), '2'],
]

const bot = () => need('botcore')
const wheels = () => {
  bot()
  need('motors_enable')
}

/** Motor power for each wheel, given a direction and a speed expression. */
function wheelPowers(direction, speed) {
  switch (direction) {
    case 'backward':
      return [`-(${speed})`, `-(${speed})`]
    case 'left':
      return [`-(${speed})`, speed]
    case 'right':
      return [speed, `-(${speed})`]
    default:
      return [speed, speed]
  }
}

defineBlocks([
  // --------------------------------------------------------------- move
  {
    json: {
      type: 'codebot_drive',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: DIRECTIONS },
        { type: 'input_value', name: 'POWER', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block, gen) => {
      wheels()
      const [l, r] = wheelPowers(block.getFieldValue('DIR'), value(gen, block, 'POWER', '60'))
      return `motors.run(LEFT, ${l})\nmotors.run(RIGHT, ${r})\n`
    },
  },
  {
    json: {
      type: 'codebot_drive_for',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: DIRECTIONS },
        { type: 'input_value', name: 'POWER', check: 'Number' },
        { type: 'input_value', name: 'SECS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block, gen) => {
      wheels()
      need('time')
      const [l, r] = wheelPowers(block.getFieldValue('DIR'), value(gen, block, 'POWER', '60'))
      return (
        `motors.run(LEFT, ${l})\n` +
        `motors.run(RIGHT, ${r})\n` +
        `time.sleep(${value(gen, block, 'SECS', '1')})\n` +
        'motors.run(LEFT, 0)\nmotors.run(RIGHT, 0)\n'
      )
    },
  },
  {
    json: {
      type: 'codebot_motor',
      args0: [
        { type: 'field_dropdown', name: 'SIDE', options: SIDES },
        { type: 'input_value', name: 'POWER', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: (block, gen) => {
      wheels()
      return `motors.run(${block.getFieldValue('SIDE')}, ${value(gen, block, 'POWER', '60')})\n`
    },
  },
  {
    json: {
      type: 'codebot_stop',
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
    },
    python: () => {
      wheels()
      return 'motors.run(LEFT, 0)\nmotors.run(RIGHT, 0)\n'
    },
  },

  // ------------------------------------------------------------- lights
  {
    json: {
      type: 'codebot_led',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7']],
        },
        { type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.user_num(${block.getFieldValue('NUM')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_leds_all',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), '0xFF'], [msg('block.opt.off'), '0x00']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.user(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_leds_pattern',
      args0: [{ type: 'field_input', name: 'BITS', text: '10101010' }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      const bits = (block.getFieldValue('BITS') || '').replace(/[^01]/g, '').slice(0, 8).padStart(8, '0')
      return `leds.user(0b${bits})\n`
    },
  },

  {
    json: {
      type: 'codebot_ls_led',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
        { type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.ls_num(${block.getFieldValue('NUM')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_ls_leds_all',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), '0b11111'], [msg('block.opt.off'), '0b00000']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.ls(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_prox_led',
      args0: [
        { type: 'field_dropdown', name: 'SIDE', options: [[msg('block.opt.left'), '0'], [msg('block.opt.right'), '1']] },
        { type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.prox_num(${block.getFieldValue('SIDE')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_pwr_led',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.pwr(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_usb_led',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      bot()
      return `leds.usb(${block.getFieldValue('ON')})\n`
    },
  },

  // ------------------------------------------------------------ sensors
  {
    json: {
      type: 'codebot_line_sees',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
      ],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`ls.check()[${block.getFieldValue('NUM')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_line_value',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
      ],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`ls.read(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_prox',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: [[msg('block.opt.left'), '0'], [msg('block.opt.right'), '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`prox.detect()[${block.getFieldValue('SIDE')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_prox_range',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: [[msg('block.opt.left'), '0'], [msg('block.opt.right'), '1']] }],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`prox.range()[${block.getFieldValue('SIDE')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_button',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`buttons.is_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_button_was',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`buttons.was_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_accel',
      args0: [{ type: 'field_dropdown', name: 'AXIS', options: AXES }],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`accel.read()[${block.getFieldValue('AXIS')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_encoder',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: SIDES }],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`enc.read(${block.getFieldValue('SIDE')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_volts',
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: () => {
      bot()
      return ['system.pwr_volts()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_on_usb',
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: () => {
      bot()
      return ['system.pwr_is_usb()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_temp',
      args0: [{ type: 'field_dropdown', name: 'UNIT', options: [[msg('block.opt.deg_f'), 'temp_F'], [msg('block.opt.deg_c'), 'temp_C']] }],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      bot()
      return [`system.${block.getFieldValue('UNIT')}()`, Order.FUNCTION_CALL]
    },
  },

  // -------------------------------------------------------------- sound
  {
    json: {
      type: 'codebot_tone_for',
      args0: [
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'SECS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: (block, gen) => {
      bot()
      need('time')
      return (
        `spkr.pitch(${value(gen, block, 'FREQ', '440')})\n` +
        `time.sleep(${value(gen, block, 'SECS', '0.3')})\n` +
        'spkr.off()\n'
      )
    },
  },
  {
    json: {
      type: 'codebot_tone',
      args0: [{ type: 'input_value', name: 'FREQ', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: (block, gen) => {
      bot()
      return `spkr.pitch(${value(gen, block, 'FREQ', '440')})\n`
    },
  },
  {
    json: {
      type: 'codebot_quiet',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: () => {
      bot()
      return 'spkr.off()\n'
    },
  },
])
