/**
 * Starter projects: short block programs a class can open and run, five or
 * six per board, easiest first. Each has a title and a one-line goal; its
 * words go through t(), so a project opens in the page's language.
 *
 * To add one: write it with the helpers in build.js, add its strings to
 * src/i18n/en.js (and es.js), and tests/examples.mjs checks that it loads,
 * turns into Python and runs in the simulator.
 */
import { t } from '../i18n/index.js'
import {
  b, color, program, repeat, until, ifElse, compare, or, math, random, round, join,
  getVar, setVar, countWith,
} from './build.js'

// ----------------------------------------------------------------- CodeBot

const drive = (dir, power) => b('codebot_drive', { DIR: dir }, { POWER: power })
const driveFor = (dir, power, secs) => b('codebot_drive_for', { DIR: dir }, { POWER: power, SECS: secs })
const botTone = (freq, secs) => b('codebot_tone_for', {}, { FREQ: freq, SECS: secs })
const wait = (secs) => b('ocb_wait', {}, { SECS: secs })
const say = (text) => b('ocb_print', {}, { TEXT: text })
const prox = (side) => b('codebot_prox', { SIDE: side })
const lineSees = (num) => b('codebot_line_sees', { NUM: num })

const codebot = [
  {
    id: 'lights',
    blocks: () =>
      program({
        start: [
          b('codebot_leds_all', { ON: '0xFF' }),
          b('codebot_ls_leds_all', { ON: '0b11111' }),
          botTone(523, 0.3),
          wait(1),
          b('codebot_leds_all', { ON: '0x00' }),
          b('codebot_ls_leds_all', { ON: '0b00000' }),
          say(t('example.text.done')),
        ],
      }),
  },
  {
    id: 'square',
    blocks: () =>
      program({
        start: [repeat(4, [driveFor('forward', 50, 1), driveFor('right', 40, 0.45)]), b('codebot_stop')],
      }),
  },
  {
    id: 'countdown',
    blocks: () =>
      program({
        variables: { count: t('example.var.count') },
        start: [
          countWith('count', 3, 1, 1, [say(getVar('count')), botTone(440, 0.2), wait(0.8)]),
          botTone(880, 0.5),
          driveFor('forward', 70, 1.5),
        ],
      }),
  },
  {
    id: 'wall',
    blocks: () =>
      program({
        forever: [
          ifElse([[or(prox('0'), prox('1')), [b('codebot_stop'), botTone(330, 0.2)]]], [drive('forward', 40)]),
          wait(0.05),
        ],
      }),
  },
  {
    id: 'explore',
    blocks: () =>
      program({
        forever: [
          ifElse(
            [
              [prox('0'), [driveFor('backward', 40, 0.5), driveFor('right', 40, 0.5)]],
              [prox('1'), [driveFor('backward', 40, 0.5), driveFor('left', 40, 0.5)]],
            ],
            [drive('forward', 40)],
          ),
          wait(0.05),
        ],
      }),
  },
  {
    id: 'line',
    blocks: () =>
      program({
        forever: [
          ifElse(
            [
              [lineSees('2'), [drive('forward', 30)]],
              [lineSees('1'), [drive('left', 25)]],
              [lineSees('3'), [drive('right', 25)]],
            ],
            [b('codebot_stop')],
          ),
          wait(0.02),
        ],
      }),
  },
]

// ------------------------------------------------------------------- CodeX

const show = (thing) => b('codex_show', {}, { THING: thing })
const fill = (name, bright = 30) => b('codex_pixels_fill', { BRIGHT: bright }, { COLOR: color(name) })
const note = (hz, secs) => b('codex_note', { NOTE: String(hz), SECS: secs })
const pressed = (btn) => b('codex_button_pressed', { BTN: btn })
const circle = (mode, x, y, r, c) => b('codex_draw_circle', { MODE: mode }, { X: x, Y: y, R: r, COLOR: color(c) })
const line = (x1, y1, x2, y2, c) => b('codex_draw_line', {}, { X1: x1, Y1: y1, X2: x2, Y2: y2, COLOR: color(c) })

const codex = [
  {
    id: 'hello',
    blocks: () =>
      program({
        start: [show(t('example.text.hello')), fill('YELLOW'), note(523, 0.3), note(659, 0.3), note(784, 0.5)],
      }),
  },
  {
    id: 'traffic',
    blocks: () =>
      program({
        forever: [
          fill('GREEN'), show(t('example.text.go')), wait(2),
          fill('YELLOW'), show(t('example.text.slow')), wait(1),
          fill('RED'), show(t('example.text.stop')), wait(2),
        ],
      }),
  },
  {
    id: 'face',
    blocks: () =>
      program({
        start: [
          b('codex_clear'),
          circle('fill_circle', 120, 120, 90, 'YELLOW'),
          circle('fill_circle', 85, 95, 12, 'BLACK'),
          circle('fill_circle', 155, 95, 12, 'BLACK'),
          line(80, 150, 120, 175, 'BLACK'),
          line(120, 175, 160, 150, 'BLACK'),
        ],
      }),
  },
  {
    id: 'piano',
    blocks: () =>
      program({
        forever: [
          ifElse([[pressed('BTN_A'), [note(262, 0.2)]]]),
          ifElse([[pressed('BTN_B'), [note(330, 0.2)]]]),
          ifElse([[pressed('BTN_U'), [note(392, 0.2)]]]),
          ifElse([[pressed('BTN_D'), [note(523, 0.2)]]]),
        ],
      }),
  },
  {
    id: 'level',
    blocks: () =>
      program({
        variables: { tilt: t('example.var.tilt') },
        forever: [
          setVar('tilt', b('codex_accel', { AXIS: '0' })),
          ifElse(
            [
              [compare(getVar('tilt'), '>', 3000), [fill('RED')]],
              [compare(getVar('tilt'), '<', -3000), [fill('BLUE')]],
            ],
            [fill('GREEN')],
          ),
          wait(0.1),
        ],
      }),
  },
  {
    id: 'reaction',
    blocks: () =>
      program({
        variables: { start: t('example.var.start') },
        start: [
          show(t('example.text.ready')),
          b('codex_pixels_off'),
          wait(random(2, 5)),
          fill('GREEN', 60),
          setVar('start', b('ocb_seconds_since_start')),
          until(b('codex_button_was_pressed', { BTN: 'BTN_A' }), [b('ocb_wait_ms', {}, { MS: 5 })]),
          show(join(round(math(math(b('ocb_seconds_since_start'), '-', getVar('start')), '*', 1000)), t('example.text.ms'))),
          b('codex_pixels_off'),
        ],
      }),
  },
]

// ----------------------------------------------------------------- CodeAIR

const airFill = (name, bright = 40) => b('codeair_pixels_fill', { BRIGHT: bright }, { COLOR: color(name) })
const beep = (freq, ms) => b('codeair_beep', {}, { FREQ: freq, MS: ms })
const flight = (steps) => b('codeair_safe_flight', {}, { DO: steps })
const takeOff = (height) => b('codeair_take_off', { HEIGHT: height })

const codeair = [
  {
    id: 'rainbow',
    blocks: () =>
      program({
        start: [
          ...['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'].flatMap((c) => [airFill(c), wait(0.5)]),
          b('codeair_pixels_off'),
        ],
      }),
  },
  {
    id: 'blink',
    blocks: () =>
      program({
        start: [
          repeat(3, [
            b('codeair_status_led', {}, { BRIGHT: 255 }),
            beep(880, 150),
            wait(0.3),
            b('codeair_status_led', {}, { BRIGHT: 0 }),
            wait(0.3),
          ]),
        ],
      }),
  },
  {
    id: 'hop',
    blocks: () =>
      program({
        start: [flight([takeOff(0.4), b('codeair_hover', {}, { SECS: 2 }), b('codeair_land')])],
      }),
  },
  {
    id: 'square',
    blocks: () =>
      program({
        start: [
          flight([
            takeOff(0.5),
            repeat(4, [
              b('codeair_move', { DIR: 'forward', DIST: 0.5 }),
              b('codeair_turn', { DIR: 'turn_right', ANGLE: 90 }),
            ]),
            b('codeair_land'),
          ]),
        ],
      }),
  },
  {
    id: 'battery',
    blocks: () =>
      program({
        variables: { volts: t('example.var.volts') },
        start: [
          setVar('volts', b('codeair_battery')),
          say(join(t('example.text.battery'), getVar('volts'))),
          ifElse([[compare(getVar('volts'), '>', 3.7), [airFill('GREEN'), beep(880, 200)]]], [airFill('RED'), beep(220, 500)]),
        ],
      }),
  },
  {
    id: 'button',
    blocks: () =>
      program({
        variables: { count: t('example.var.count') },
        start: [
          airFill('BLUE'),
          until(b('codeair_button_was', { NUM: '0' }), [b('ocb_wait_ms', {}, { MS: 50 })]),
          countWith('count', 3, 1, 1, [beep(660, 100), wait(1)]),
          flight([takeOff(0.5), b('codeair_circle', { DIR: 'circle_left', RADIUS: 0.5 }), b('codeair_land')]),
          b('codeair_pixels_off'),
        ],
      }),
  },
]

const SETS = { codebot, codex, codeair }

/** The starter projects for a board, easiest first: { id, title, goal }. */
export function examplesFor(device) {
  return (SETS[device] || []).map(({ id }) => ({
    id,
    title: t(`example.${device}.${id}.title`),
    goal: t(`example.${device}.${id}.goal`),
  }))
}

/** One starter project, as a project the workspace can load. */
export function exampleProject(device, id) {
  const example = (SETS[device] || []).find((e) => e.id === id)
  if (!example) return null
  return { device, name: t(`example.${device}.${id}.title`), blocks: example.blocks() }
}

export const EXAMPLE_DEVICES = Object.keys(SETS)
