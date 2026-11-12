/** CodeX handheld: screen, lights, sound, buttons, sensors. */
import { Order } from 'blockly/python'
import { msg, defineBlocks, value, numField } from './define.js'
import { need } from './context.js'

const BUTTONS = [
  [msg('block.opt.a'), 'BTN_A'],
  [msg('block.opt.b'), 'BTN_B'],
  [msg('block.opt.up'), 'BTN_U'],
  [msg('block.opt.down'), 'BTN_D'],
  [msg('block.opt.left'), 'BTN_L'],
  [msg('block.opt.right'), 'BTN_R'],
]

const AXES = [
  [msg('block.opt.side_to_side_x'), '0'],
  [msg('block.opt.front_to_back_y'), '1'],
  [msg('block.opt.up_and_down_z'), '2'],
]

/** Equal-temperament note table, so the block stays a simple dropdown. */
const NOTES = [
  [msg('block.opt.c4'), '262'], [msg('block.opt.d4'), '294'], [msg('block.opt.e4'), '330'], [msg('block.opt.f4'), '349'], [msg('block.opt.g4'), '392'],
  [msg('block.opt.a4'), '440'], [msg('block.opt.b4'), '494'], [msg('block.opt.c5'), '523'], [msg('block.opt.d5'), '587'], [msg('block.opt.e5'), '659'],
  [msg('block.opt.f5'), '698'], [msg('block.opt.g5'), '784'], [msg('block.opt.a5'), '880'], [msg('block.opt.b5'), '988'], [msg('block.opt.c6'), '1047'],
]

const codex = () => need('codex', 'colors')

defineBlocks([
  // ------------------------------------------------------------- screen
  {
    json: {
      type: 'codex_show',
      args0: [{ type: 'input_value', name: 'THING' }],
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      return `display.show(${value(gen, block, 'THING', "''")})\n`
    },
  },
  {
    json: {
      type: 'codex_print',
      args0: [
        { type: 'input_value', name: 'THING' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      return `display.print(${value(gen, block, 'THING', "''")}, ${value(gen, block, 'COLOR', 'WHITE')})\n`
    },
  },
  {
    json: {
      type: 'codex_clear',
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: () => {
      codex()
      return 'display.clear()\n'
    },
  },
  {
    json: {
      type: 'codex_draw_text',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'Y', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'SCALE', value: 2, min: 1, max: 8, precision: 1 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      const args = [
        value(gen, block, 'TEXT', "''"),
        value(gen, block, 'X', '0'),
        value(gen, block, 'Y', '0'),
        value(gen, block, 'COLOR', 'WHITE'),
        `scale=${numField(block, 'SCALE', 2)}`,
      ]
      return `display.draw_text(${args.join(', ')})\n`
    },
  },
  {
    json: {
      type: 'codex_draw_rect',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            [msg('block.opt.draw'), 'draw_rect'],
            [msg('block.opt.fill'), 'fill_rect'],
          ],
        },
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'Y', check: 'Number' },
        { type: 'input_value', name: 'W', check: 'Number' },
        { type: 'input_value', name: 'H', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      const args = ['X', 'Y', 'W', 'H'].map((n) => value(gen, block, n, '0'))
      args.push(value(gen, block, 'COLOR', 'WHITE'))
      return `display.${block.getFieldValue('MODE')}(${args.join(', ')})\n`
    },
  },
  {
    json: {
      type: 'codex_draw_circle',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            [msg('block.opt.draw'), 'draw_circle'],
            [msg('block.opt.fill'), 'fill_circle'],
          ],
        },
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'Y', check: 'Number' },
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      const args = ['X', 'Y', 'R'].map((n) => value(gen, block, n, '0'))
      args.push(value(gen, block, 'COLOR', 'WHITE'))
      return `display.${block.getFieldValue('MODE')}(${args.join(', ')})\n`
    },
  },
  {
    json: {
      type: 'codex_draw_line',
      args0: [
        { type: 'input_value', name: 'X1', check: 'Number' },
        { type: 'input_value', name: 'Y1', check: 'Number' },
        { type: 'input_value', name: 'X2', check: 'Number' },
        { type: 'input_value', name: 'Y2', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      const args = ['X1', 'Y1', 'X2', 'Y2'].map((n) => value(gen, block, n, '0'))
      args.push(value(gen, block, 'COLOR', 'WHITE'))
      return `display.draw_line(${args.join(', ')})\n`
    },
  },
  {
    json: {
      type: 'codex_set_pixel',
      args0: [
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'Y', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      const args = ['X', 'Y'].map((n) => value(gen, block, n, '0'))
      args.push(value(gen, block, 'COLOR', 'WHITE'))
      return `display.set_pixel(${args.join(', ')})\n`
    },
  },
  {
    json: {
      type: 'codex_brightness',
      args0: [{ type: 'input_value', name: 'PCT', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
    },
    python: (block, gen) => {
      codex()
      return `tft.brightness = ${value(gen, block, 'PCT', '100')}\n`
    },
  },

  // ------------------------------------------------------------- lights
  {
    json: {
      type: 'codex_pixel_set',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']] },
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      codex()
      return `pixels.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codex_pixels_fill',
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
      codex()
      return `pixels.fill(${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codex_pixels_off',
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: () => {
      codex()
      return 'pixels.off()\n'
    },
  },
  {
    json: {
      type: 'codex_led',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], [msg('block.opt.b'), 'LED_B'], [msg('block.opt.a'), 'LED_A']],
        },
        { type: 'field_dropdown', name: 'ON', options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
    },
    python: (block) => {
      codex()
      return `leds.set(${block.getFieldValue('NUM')}, ${block.getFieldValue('ON')})\n`
    },
  },

  // -------------------------------------------------------------- sound
  {
    json: {
      type: 'codex_note',
      args0: [
        { type: 'field_dropdown', name: 'NOTE', options: NOTES },
        { type: 'field_number', name: 'SECS', value: 0.4, min: 0.05, max: 10, precision: 0.05 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: (block) => {
      codex()
      const label = block.getField('NOTE').getText()
      return `audio.pitch(${block.getFieldValue('NOTE')}, ${numField(block, 'SECS', 0.4)})  # ${label}\n`
    },
  },
  {
    json: {
      type: 'codex_tone',
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
      codex()
      return `audio.pitch(${value(gen, block, 'FREQ', '440')}, ${value(gen, block, 'SECS', '0.5')})\n`
    },
  },
  {
    json: {
      type: 'codex_song',
      args0: [{ type: 'field_input', name: 'SONG', text: '4C5 4E5 4G5 2C6' }],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: (block) => {
      codex()
      need('songplayer')
      return `song_player.play_song(${JSON.stringify(block.getFieldValue('SONG'))})\n`
    },
  },
  {
    json: {
      type: 'codex_sound_off',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
    },
    python: () => {
      codex()
      return 'audio.off()\n'
    },
  },

  // ------------------------------------------------------------ sensors
  {
    json: {
      type: 'codex_button_pressed',
      args0: [{ type: 'field_dropdown', name: 'BTN', options: BUTTONS }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      codex()
      return [`buttons.is_pressed(${block.getFieldValue('BTN')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_button_was_pressed',
      args0: [{ type: 'field_dropdown', name: 'BTN', options: BUTTONS }],
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: (block) => {
      codex()
      return [`buttons.was_pressed(${block.getFieldValue('BTN')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_accel',
      args0: [{ type: 'field_dropdown', name: 'AXIS', options: AXES }],
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: (block) => {
      codex()
      return [`accel.read()[${block.getFieldValue('AXIS')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codex_light',
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: () => {
      codex()
      return ['light.read_lux()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_battery',
      output: 'Number',
      style: 'sensors_blocks',
    },
    python: () => {
      codex()
      return ['power.get_battery_voltage()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_on_usb',
      output: 'Boolean',
      style: 'sensors_blocks',
    },
    python: () => {
      codex()
      return ['power.is_usb()', Order.FUNCTION_CALL]
    },
  },
])
