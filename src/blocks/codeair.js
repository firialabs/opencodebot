/** CodeAIR drone: flying, lights, sound, buttons, battery. */
import { Order } from 'blockly/python'
import { defineBlocks, value, numField, body } from './define.js'
import { need } from './context.js'

const MOVES = [
  ['forward', 'forward'],
  ['backward', 'back'],
  ['left', 'left'],
  ['right', 'right'],
  ['up', 'up'],
  ['down', 'down'],
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
      message0: '🛫 flight plan',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip:
        'Put your flying blocks in here. If anything goes wrong, CodeAIR lands itself instead of staying in the air.',
    },
    python: (block, gen) => {
      flight()
      return `with recorder:\n${body(gen, block)}`
    },
  },
  {
    json: {
      type: 'codeair_take_off',
      message0: '🛫 take off to %1 meters',
      args0: [{ type: 'field_number', name: 'HEIGHT', value: 0.4, min: 0.2, max: 2, precision: 0.1 }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Lift off and hover steadily at this height.',
    },
    python: (block) => {
      flight()
      return `fly.take_off(${numField(block, 'HEIGHT', 0.4)})\n`
    },
  },
  {
    json: {
      type: 'codeair_land',
      message0: '🛬 land',
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Come down gently and switch the motors off.',
    },
    python: () => {
      flight()
      return 'fly.land()\n'
    },
  },
  {
    json: {
      type: 'codeair_move',
      message0: '✈️ fly %1 %2 meters',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: MOVES },
        { type: 'field_number', name: 'DIST', value: 0.5, min: 0.1, max: 5, precision: 0.1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Move in a straight line, then hold still again.',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'DIST', 0.5)})\n`
    },
  },
  {
    json: {
      type: 'codeair_turn',
      message0: '🔄 turn %1 %2 degrees',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: [['left', 'turn_left'], ['right', 'turn_right']] },
        { type: 'field_number', name: 'ANGLE', value: 90, min: 1, max: 360 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Spin on the spot.',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'ANGLE', 90)})\n`
    },
  },
  {
    json: {
      type: 'codeair_circle',
      message0: '🌀 circle %1 with radius %2 meters',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: [['left', 'circle_left'], ['right', 'circle_right']] },
        { type: 'field_number', name: 'RADIUS', value: 0.5, min: 0.1, max: 3, precision: 0.1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Fly a full circle around a point.',
    },
    python: (block) => {
      flight()
      return `fly.${block.getFieldValue('DIR')}(${numField(block, 'RADIUS', 0.5)})\n`
    },
  },
  {
    json: {
      type: 'codeair_hover',
      message0: '🚁 hover for %1 seconds',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip:
        'Hold position in the air. Use this instead of a plain wait while flying — it keeps CodeAIR steady.',
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
      message0: '✨ set neopixel %1 to %2 brightness %3 %%',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [
            ['front right top (0)', '0'],
            ['front right bottom (1)', '1'],
            ['front left top (2)', '2'],
            ['front left bottom (3)', '3'],
            ['rear left bottom (4)', '4'],
            ['rear left top (5)', '5'],
            ['rear right top (6)', '6'],
            ['rear right bottom (7)', '7'],
          ],
        },
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Light up one of the eight colour LEDs around the drone.',
    },
    python: (block, gen) => {
      air()
      return `pixels.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codeair_pixels_fill',
      message0: '✨ set all neopixels to %1 brightness %2 %%',
      args0: [
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'All eight colour LEDs at once.',
    },
    python: (block, gen) => {
      air()
      return `pixels.fill(${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codeair_pixels_off',
      message0: '✨ turn all neopixels off',
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch the colour LEDs off.',
    },
    python: () => {
      air()
      return 'pixels.off()\n'
    },
  },
  {
    json: {
      type: 'codeair_led',
      message0: '💡 set blue LED %1 brightness to %2',
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
      tooltip: 'Brightness goes from 0 (off) to 255 (full).',
    },
    python: (block, gen) => {
      air()
      return `leds.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'BRIGHT', '255')})\n`
    },
  },
  {
    json: {
      type: 'codeair_status_led',
      message0: '💡 set status LED brightness to %1',
      args0: [{ type: 'input_value', name: 'BRIGHT', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'The little status light on the drone.',
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
      message0: '🎵 beep %1 Hz for %2 ms',
      args0: [
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'MS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'A short beep from the drone.',
    },
    python: (block, gen) => {
      air()
      return `speaker.beep(${value(gen, block, 'FREQ', '440')}, ${value(gen, block, 'MS', '250')})\n`
    },
  },
  {
    json: {
      type: 'codeair_quiet',
      message0: '🔇 stop the sound',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Silence.',
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
      message0: '🔘 button %1 is pressed',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True while the button is held down.',
    },
    python: (block) => {
      air()
      return [`buttons.is_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_button_was',
      message0: '🔘 button %1 was pressed',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True once per press.',
    },
    python: (block) => {
      air()
      return [`buttons.was_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_battery',
      message0: '🔋 battery volts',
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'Check before you fly — a tired battery makes for a wobbly flight.',
    },
    python: () => {
      air()
      return ['power.battery_voltage()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codeair_on_usb',
      message0: '🔌 plugged into USB',
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True when the drone is running from the USB cable.',
    },
    python: () => {
      air()
      return ['power.is_usb()', Order.FUNCTION_CALL]
    },
  },
])
