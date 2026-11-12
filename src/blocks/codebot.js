/** CodeBot CB3: driving, lights, line and proximity sensors, sound. */
import { Order } from 'blockly/python'
import { defineBlocks, value } from './define.js'
import { need } from './context.js'

const DIRECTIONS = [
  ['forward', 'forward'],
  ['backward', 'backward'],
  ['turn left', 'left'],
  ['turn right', 'right'],
]

const SIDES = [
  ['left', 'LEFT'],
  ['right', 'RIGHT'],
]

const LINE_SENSORS = [
  ['far left (0)', '0'],
  ['left (1)', '1'],
  ['middle (2)', '2'],
  ['right (3)', '3'],
  ['far right (4)', '4'],
]

const AXES = [
  ['side to side (x)', '0'],
  ['front to back (y)', '1'],
  ['up and down (z)', '2'],
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
      message0: '🤖 drive %1 at %2 %% power',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: DIRECTIONS },
        { type: 'input_value', name: 'POWER', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Start driving and keep going until something stops the motors.',
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
      message0: '🤖 drive %1 at %2 %% power for %3 seconds',
      args0: [
        { type: 'field_dropdown', name: 'DIR', options: DIRECTIONS },
        { type: 'input_value', name: 'POWER', check: 'Number' },
        { type: 'input_value', name: 'SECS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Drive for a set time, then stop.',
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
      message0: '🤖 set %1 motor to %2 %% power',
      args0: [
        { type: 'field_dropdown', name: 'SIDE', options: SIDES },
        { type: 'input_value', name: 'POWER', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Drive one wheel on its own. Use a negative number to go backward.',
    },
    python: (block, gen) => {
      wheels()
      return `motors.run(${block.getFieldValue('SIDE')}, ${value(gen, block, 'POWER', '60')})\n`
    },
  },
  {
    json: {
      type: 'codebot_stop',
      message0: '🛑 stop driving',
      previousStatement: null,
      nextStatement: null,
      style: 'move_blocks',
      tooltip: 'Stop both wheels.',
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
      message0: '💡 turn top LED %1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'NUM',
          options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7']],
        },
        { type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch one of the eight LEDs on the top of the robot.',
    },
    python: (block) => {
      bot()
      return `leds.user_num(${block.getFieldValue('NUM')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_leds_all',
      message0: '💡 turn all top LEDs %1',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [['on', '0xFF'], ['off', '0x00']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'All eight LEDs at once.',
    },
    python: (block) => {
      bot()
      return `leds.user(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_leds_pattern',
      message0: '💡 show top LED pattern %1',
      args0: [{ type: 'field_input', name: 'BITS', text: '10101010' }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Eight 1s and 0s, one per LED. 1 means on.',
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
      message0: '💡 turn line sensor LED %1 %2',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
        { type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch one of the five LEDs above the line sensors, on the front of the robot.',
    },
    python: (block) => {
      bot()
      return `leds.ls_num(${block.getFieldValue('NUM')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_ls_leds_all',
      message0: '💡 turn all line sensor LEDs %1',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [['on', '0b11111'], ['off', '0b00000']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'All five line sensor LEDs at once.',
    },
    python: (block) => {
      bot()
      return `leds.ls(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_prox_led',
      message0: '💡 turn %1 proximity LED %2',
      args0: [
        { type: 'field_dropdown', name: 'SIDE', options: [['left', '0'], ['right', '1']] },
        { type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'Switch the LED next to a proximity sensor.',
    },
    python: (block) => {
      bot()
      return `leds.prox_num(${block.getFieldValue('SIDE')}, ${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_pwr_led',
      message0: '💡 turn power LED %1',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'The power light, next to the on/off switch.',
    },
    python: (block) => {
      bot()
      return `leds.pwr(${block.getFieldValue('ON')})\n`
    },
  },
  {
    json: {
      type: 'codebot_usb_led',
      message0: '💡 turn USB LED %1',
      args0: [{ type: 'field_dropdown', name: 'ON', options: [['on', 'True'], ['off', 'False']] }],
      previousStatement: null,
      nextStatement: null,
      style: 'lights_blocks',
      tooltip: 'The light next to the USB socket.',
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
      message0: '👀 line sensor %1 sees a line',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
      ],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True when that sensor is over a line.',
    },
    python: (block) => {
      bot()
      return [`ls.check()[${block.getFieldValue('NUM')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_line_value',
      message0: '👀 line sensor %1 reading',
      args0: [
        { type: 'field_dropdown', name: 'NUM', options: LINE_SENSORS },
      ],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'The raw number from a line sensor. Darker surfaces read lower.',
    },
    python: (block) => {
      bot()
      return [`ls.read(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_prox',
      message0: '📡 something is close on the %1',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', '0'], ['right', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True when the proximity sensor spots an obstacle.',
    },
    python: (block) => {
      bot()
      return [`prox.detect()[${block.getFieldValue('SIDE')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_prox_range',
      message0: '📡 proximity reading on the %1',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', '0'], ['right', '1']] }],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'A number from 0 to 100 from the proximity sensor on that side.',
    },
    python: (block) => {
      bot()
      return [`prox.range()[${block.getFieldValue('SIDE')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_button',
      message0: '🔘 button %1 is pressed',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True while the button on the robot is held down.',
    },
    python: (block) => {
      bot()
      return [`buttons.is_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_button_was',
      message0: '🔘 button %1 was pressed',
      args0: [{ type: 'field_dropdown', name: 'NUM', options: [['0', '0'], ['1', '1']] }],
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True if the button was pressed since the last time you checked, even if it is up now.',
    },
    python: (block) => {
      bot()
      return [`buttons.was_pressed(${block.getFieldValue('NUM')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_accel',
      message0: '📐 tilt %1',
      args0: [{ type: 'field_dropdown', name: 'AXIS', options: AXES }],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'How the robot is tilted.',
    },
    python: (block) => {
      bot()
      return [`accel.read()[${block.getFieldValue('AXIS')}]`, Order.MEMBER]
    },
  },
  {
    json: {
      type: 'codebot_encoder',
      message0: '⚙️ %1 wheel encoder',
      args0: [{ type: 'field_dropdown', name: 'SIDE', options: SIDES }],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'Reading from the wheel encoder, for measuring distance.',
    },
    python: (block) => {
      bot()
      return [`enc.read(${block.getFieldValue('SIDE')})`, Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_volts',
      message0: '🔋 battery volts',
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'Supply voltage, so you can tell when batteries are low.',
    },
    python: () => {
      bot()
      return ['system.pwr_volts()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_on_usb',
      message0: '🔌 powered by USB',
      output: 'Boolean',
      style: 'sensors_blocks',
      tooltip: 'True when the power switch is set to USB rather than batteries.',
    },
    python: () => {
      bot()
      return ['system.pwr_is_usb()', Order.FUNCTION_CALL]
    },
  },
  {
    json: {
      type: 'codebot_temp',
      message0: '🌡️ temperature in %1',
      args0: [{ type: 'field_dropdown', name: 'UNIT', options: [['°F', 'temp_F'], ['°C', 'temp_C']] }],
      output: 'Number',
      style: 'sensors_blocks',
      tooltip: 'How warm the robot is.',
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
      message0: '🎵 play %1 Hz for %2 seconds',
      args0: [
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'SECS', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Beep for a moment, then go quiet.',
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
      message0: '🎵 start playing %1 Hz',
      args0: [{ type: 'input_value', name: 'FREQ', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Hold a note until you stop it.',
    },
    python: (block, gen) => {
      bot()
      return `spkr.pitch(${value(gen, block, 'FREQ', '440')})\n`
    },
  },
  {
    json: {
      type: 'codebot_quiet',
      message0: '🔇 stop the sound',
      previousStatement: null,
      nextStatement: null,
      style: 'sound_blocks',
      tooltip: 'Silence.',
    },
    python: () => {
      bot()
      return 'spkr.off()\n'
    },
  },
])
