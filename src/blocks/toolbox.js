/**
 * The toolbox a teacher sees depends on which board they picked, so nobody
 * has to scroll past blocks their hardware cannot do.
 */

const num = (value) => ({ shadow: { type: 'math_number', fields: { NUM: value } } })
const str = (text) => ({ shadow: { type: 'text', fields: { TEXT: text } } })
const col = (name = 'RED') => ({ shadow: { type: 'ocb_color', fields: { COLOR: name } } })

const block = (type, inputs) => (inputs ? { kind: 'block', type, inputs } : { kind: 'block', type })

const category = (name, style, contents) => ({
  kind: 'category',
  name,
  categorystyle: style,
  contents,
})

const SEP = { kind: 'sep', gap: '28' }

// ---------------------------------------------------------------- shared

const basics = [
  block('ocb_on_start'),
  block('ocb_forever'),
  block('ocb_wait', { SECS: num(1) }),
  block('ocb_wait_ms', { MS: num(500) }),
  block('ocb_print', { TEXT: str('Hello!') }),
  block('ocb_seconds_since_start'),
  block('ocb_python'),
]

const logic = [
  block('controls_if'),
  { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
  block('logic_compare', { A: num(1), B: num(1) }),
  block('logic_operation'),
  block('logic_negate'),
  block('logic_boolean'),
]

const loops = [
  block('controls_repeat_ext', { TIMES: num(4) }),
  block('controls_whileUntil'),
  block('controls_for', { FROM: num(1), TO: num(10), BY: num(1) }),
  block('controls_forEach'),
  block('controls_flow_statements'),
]

const math = [
  block('math_number'),
  block('math_arithmetic', { A: num(1), B: num(1) }),
  block('math_single', { NUM: num(9) }),
  block('math_round', { NUM: num(3.1) }),
  block('math_modulo', { DIVIDEND: num(64), DIVISOR: num(10) }),
  block('math_random_int', { FROM: num(1), TO: num(100) }),
  block('math_constrain', { VALUE: num(50), LOW: num(1), HIGH: num(100) }),
]

const text = [
  block('text'),
  block('text_join'),
  block('text_length', { VALUE: str('hello') }),
  block('text_changeCase', { TEXT: str('hello') }),
  block('text_isEmpty', { VALUE: str('') }),
]

const lists = [
  block('lists_create_with'),
  block('lists_length'),
  block('lists_getIndex'),
  block('lists_setIndex'),
]

const generalTail = [
  SEP,
  category('🤔 Logic', 'logic_category', logic),
  category('🔁 Loops', 'loops_category', loops),
  category('🔢 Math', 'math_category', math),
  category('🔤 Text', 'text_category', text),
  category('📋 Lists', 'lists_category', lists),
  SEP,
  { kind: 'category', name: '📦 Variables', categorystyle: 'variables_category', custom: 'VARIABLE' },
  { kind: 'category', name: '🧰 Functions', categorystyle: 'functions_category', custom: 'PROCEDURE' },
]

// ---------------------------------------------------------------- CodeX

const codexCategories = [
  category('🖥️ Screen', 'screen_category', [
    block('codex_show', { THING: str('Hi!') }),
    block('codex_print', { THING: str('Hello'), COLOR: col('WHITE') }),
    block('codex_clear'),
    block('codex_draw_text', { TEXT: str('Score'), X: num(10), Y: num(10), COLOR: col('YELLOW') }),
    block('codex_draw_rect', { X: num(20), Y: num(20), W: num(80), H: num(50), COLOR: col('GREEN') }),
    block('codex_draw_circle', { X: num(120), Y: num(120), R: num(30), COLOR: col('CYAN') }),
    block('codex_draw_line', { X1: num(0), Y1: num(0), X2: num(239), Y2: num(239), COLOR: col('MAGENTA') }),
    block('codex_set_pixel', { X: num(120), Y: num(120), COLOR: col('WHITE') }),
    block('codex_brightness', { PCT: num(80) }),
  ]),
  category('✨ Lights', 'lights_category', [
    block('codex_pixel_set', { COLOR: col('PINK') }),
    block('codex_pixels_fill', { COLOR: col('PURPLE') }),
    block('codex_pixels_off'),
    block('codex_led'),
    block('ocb_color'),
    block('ocb_rgb', { R: num(255), G: num(120), B: num(200) }),
  ]),
  category('🎵 Sound', 'sound_category', [
    block('codex_note'),
    block('codex_tone', { FREQ: num(440), SECS: num(0.5) }),
    block('codex_song'),
    block('codex_sound_off'),
  ]),
  category('👀 Sensors', 'sensors_category', [
    block('codex_button_pressed'),
    block('codex_button_was_pressed'),
    block('codex_accel'),
    block('codex_light'),
    block('codex_battery'),
  ]),
  category('🛜 Radio', 'radio_category', [
    block('radio_on'),
    block('radio_send', { MSG: str('hello') }),
    block('radio_on_message'),
    block('radio_receive'),
  ]),
]

// -------------------------------------------------------------- CodeBot

const codebotCategories = [
  category('🚗 Drive', 'move_category', [
    block('codebot_drive', { POWER: num(60) }),
    block('codebot_drive_for', { POWER: num(60), SECS: num(1) }),
    block('codebot_motor', { POWER: num(60) }),
    block('codebot_stop'),
  ]),
  category('✨ Lights', 'lights_category', [
    block('codebot_led'),
    block('codebot_leds_all'),
    block('codebot_leds_pattern'),
  ]),
  category('👀 Sensors', 'sensors_category', [
    block('codebot_line_sees'),
    block('codebot_line_value'),
    block('codebot_prox'),
    block('codebot_button'),
    block('codebot_accel'),
    block('codebot_encoder'),
    block('codebot_volts'),
  ]),
  category('🎵 Sound', 'sound_category', [
    block('codebot_tone_for', { FREQ: num(440), SECS: num(0.3) }),
    block('codebot_tone', { FREQ: num(440) }),
    block('codebot_quiet'),
  ]),
]

// -------------------------------------------------------------- CodeAIR

const codeairCategories = [
  category('🚁 Fly', 'move_category', [
    block('codeair_safe_flight'),
    block('codeair_take_off'),
    block('codeair_move'),
    block('codeair_turn'),
    block('codeair_circle'),
    block('codeair_hover', { SECS: num(2) }),
    block('codeair_land'),
  ]),
  category('✨ Lights', 'lights_category', [
    block('codeair_pixel_set', { COLOR: col('CYAN') }),
    block('codeair_pixels_fill', { COLOR: col('GREEN') }),
    block('codeair_pixels_off'),
    block('codeair_led', { BRIGHT: num(255) }),
    block('codeair_status_led', { BRIGHT: num(255) }),
    block('ocb_color'),
    block('ocb_rgb', { R: num(255), G: num(120), B: num(200) }),
  ]),
  category('🎵 Sound', 'sound_category', [
    block('codeair_beep', { FREQ: num(880), MS: num(250) }),
    block('codeair_quiet'),
  ]),
  category('👀 Sensors', 'sensors_category', [
    block('codeair_button'),
    block('codeair_button_was'),
    block('codeair_battery'),
    block('codeair_on_usb'),
  ]),
  category('🛜 Radio', 'radio_category', [
    block('radio_on'),
    block('radio_send', { MSG: str('hello') }),
    block('radio_on_message'),
    block('radio_receive'),
  ]),
]

const DEVICE_CATEGORIES = {
  codex: codexCategories,
  codebot: codebotCategories,
  codeair: codeairCategories,
}

/** Build the toolbox for a board. Pass null for the "nothing picked" view. */
export function toolboxFor(targetId) {
  const deviceCats = DEVICE_CATEGORIES[targetId] || []
  return {
    kind: 'categoryToolbox',
    contents: [
      category('🧩 Basics', 'basics_category', basics),
      ...(deviceCats.length ? [SEP, ...deviceCats] : []),
      ...generalTail,
    ],
  }
}

/** Every block type that belongs to a specific board. */
export const DEVICE_BLOCK_PREFIX = { codex: 'codex_', codebot: 'codebot_', codeair: 'codeair_' }
