/** CodeX handheld: screen, lights, sound, buttons, sensors. */
import { Order } from 'blockly/python'
import { defineBlocks, value, numField } from './define.js'
import { need } from './context.js'

const BUTTONS = [
  ['A', 'BTN_A'],
  ['B', 'BTN_B'],
  ['up', 'BTN_U'],
  ['down', 'BTN_D'],
  ['left', 'BTN_L'],
  ['right', 'BTN_R'],
]

const AXES = [
  ['side to side (x)', '0'],
  ['front to back (y)', '1'],
  ['up and down (z)', '2'],
]

/** Equal-temperament note table, so the block stays a simple dropdown. */
const NOTES = [
  ['C4', '262'], ['D4', '294'], ['E4', '330'], ['F4', '349'], ['G4', '392'],
  ['A4', '440'], ['B4', '494'], ['C5', '523'], ['D5', '587'], ['E5', '659'],
  ['F5', '698'], ['G5', '784'], ['A5', '880'], ['B5', '988'], ['C6', '1047'],
]

const codex = () => need('codex', 'colors')

defineBlocks([
  // ------------------------------------------------------------- screen
  {
    json: {
      type: 'codex_show',
      message0: '🖵 show %1 on screen',
      args0: [{ type: 'input_value', name: 'THING' }],
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
      tooltip: 'Clear the screen and show some big text.',
    },
    python: (block, gen) => {
      codex()
      return `display.show(${value(gen, block, 'THING', "''")})\n`
    },
  },
  {
    json: {
      type: 'codex_print',
      message0: '🖵 print %1 in %2',
      args0: [
        { type: 'input_value', name: 'THING' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
      tooltip: 'Add a line of text to the screen. The screen scrolls as it fills up.',
    },
    python: (block, gen) => {
      codex()
      return `display.print(${value(gen, block, 'THING', "''")}, ${value(gen, block, 'COLOR', 'WHITE')})\n`
    },
  },
  {
    json: {
      type: 'codex_clear',
      message0: '🖵 clear the screen',
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
      tooltip: 'Wipe the screen back to black.',
    },
    python: () => {
      codex()
      return 'display.clear()\n'
    },
  },
  {
    json: {
      type: 'codex_draw_text',
      message0: '🖵 draw text %1 at x %2 y %3 in %4 size %5',
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
      tooltip: 'Draw text exactly where you want it. The screen is 240 by 240.',
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
      message0: '🖵 %1 rectangle at x %2 y %3 width %4 height %5 in %6',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['draw', 'draw_rect'],
            ['fill', 'fill_rect'],
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
      tooltip: 'Draw an outline or a solid rectangle.',
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
      message0: '🖵 %1 circle at x %2 y %3 radius %4 in %5',
      args0: [
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['draw', 'draw_circle'],
            ['fill', 'fill_circle'],
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
      tooltip: 'Draw an outline or a solid circle.',
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
      message0: '🖵 draw line from x %1 y %2 to x %3 y %4 in %5',
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
      tooltip: 'Draw a straight line between two points.',
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
      message0: '🖵 set pixel x %1 y %2 to %3',
      args0: [
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'Y', check: 'Number' },
        { type: 'input_value', name: 'COLOR' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
      tooltip: 'Colour in one single dot on the screen.',
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
      message0: '🔆 set screen brightness to %1 %%',
      args0: [{ type: 'input_value', name: 'PCT', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'screen_blocks',
      tooltip: 'Dim or brighten the backlight, from 0 to 100.',
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
      message0: '✨ set neopixel %1 to %2 brightness %3 %%',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']] },
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Light up one of the four colour LEDs.',
    },
    python: (block, gen) => {
      codex()
      return `pixels.set(${block.getFieldValue('NUM')}, ${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codex_pixels_fill',
      message0: '✨ set all neopixels to %1 brightness %2 %%',
      args0: [
        { type: 'input_value', name: 'COLOR' },
        { type: 'field_number', name: 'BRIGHT', value: 40, min: 0, max: 100 },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Light up all four colour LEDs at once.',
    },
    python: (block, gen) => {
      codex()
      return `pixels.fill(${value(gen, block, 'COLOR', 'WHITE')}, brightness=${numField(block, 'BRIGHT', 40)})\n`
    },
  },
  {
    json: {
      type: 'codex_pixels_off',
      message0: '✨ turn all neopixels off',
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch the colour LEDs off.',
    },
    python: () => {
      codex()
      return 'pixels.off()\n'
    },
  },
  {
    json: {
      type: 'codex_led',
      message0: '💡 turn red LED %1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['B', 'LED_B'], ['A', 'LED_A']],
        },
        { type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch one of the small red LEDs on or off.',
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
      message0: '🎵 play note %1 for %2 seconds',
      args0: [
        { type: 'field_dropdown', name: 'NOTE', options: NOTES },
        { type: 'field_number', name: 'SECS', value: 0.4, min: 0.05, max: 10, precision: 0.05 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Play one musical note.',
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
      message0: '🎵 play %1 Hz for %2 seconds',
      args0: [
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'SECS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Play any pitch you like. Higher numbers sound higher.',
    },
    python: (block, gen) => {
      codex()
      return `audio.pitch(${value(gen, block, 'FREQ', '440')}, ${value(gen, block, 'SECS', '0.5')})\n`
    },
  },
  {
    json: {
      type: 'codex_song',
      message0: '🎼 play song %1',
      args0: [{ type: 'field_input', name: 'SONG', text: '4C5 4E5 4G5 2C6' }],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Play a tune. Each note is length + name + octave, like 4C5.',
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
      message0: '🔇 stop the sound',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Silence.',
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
      message0: '🔘 button %1 is pressed',
      args0: [{ type: 'field_dropdown', name: 'BTN', options: BUTTONS }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True for as long as the button is held down.',
    },
    python: (block) => {
      codex()
      return [`buttons.is_pressed(${block.getFieldValue('BTN')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_button_was_pressed',
      message0: '🔘 button %1 was pressed',
      args0: [{ type: 'field_dropdown', name: 'BTN', options: BUTTONS }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True once per press, even if you let go quickly.',
    },
    python: (block) => {
      codex()
      return [`buttons.was_pressed(${block.getFieldValue('BTN')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_accel',
      message0: '📐 tilt %1',
      args0: [{ type: 'field_dropdown', name: 'AXIS', options: AXES }],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'How the CodeX is tilted. Around 0 when flat and still.',
    },
    python: (block) => {
      codex()
      return [`accel.read()[${block.getFieldValue('AXIS')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codex_light',
      message0: '🔆 light level',
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'How bright the room is, in lux.',
    },
    python: () => {
      codex()
      return ['light.read_lux()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codex_battery',
      message0: '🔋 battery volts',
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'Battery voltage, so you can warn students to recharge.',
    },
    python: () => {
      codex()
      return ['power.get_battery_voltage()', Order.FUNCTION_CALL]
    },
  },
])
