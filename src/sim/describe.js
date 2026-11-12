// The simulated board in words, for a screen reader: what the picture shows.
//
// A description of the whole board, kept current (once a second) in an
// element the view points to with aria-describedby, read when the view has
// focus; and short announcements of what changed that matters (it started
// or stopped moving, bumped into something, dropped off a ledge, took off,
// landed), in a polite live region. Positions are never announced as they
// change: a stream of numbers drowns everything else out.
//
// Every sentence is in the app's string table (src/i18n), with its numbers
// formatted for the language.
import { t, fixed } from '../i18n/index.js'

const COMPASS = ['east', 'northEast', 'north', 'northWest', 'west', 'southWest', 'south', 'southEast']
const NAMES = { codebot: 'CodeBot', codex: 'CodeX', codeair: 'CodeAIR' }

export function compass(heading) {
  const i = Math.round(heading / (Math.PI / 4))
  return t(`compass.${COMPASS[((i % 8) + 8) % 8]}`)
}

const bits = (v, n) => { let c = 0; for (let i = 0; i < n; i++) if ((v >> i) & 1) c++; return c }
const lit = (pixels) => (pixels ?? []).filter(([r, g, b]) => r + g + b > 0).length

// What a board is doing between two snapshots `dt` seconds apart: its motion,
// one of still, moving, backing, turnLeft, turnRight.
function motion(prev, s, dt) {
  if (!prev || !(dt > 0)) return 'still'
  const dx = s.x - prev.x, dy = s.y - prev.y
  const speed = Math.hypot(dx, dy) / dt
  let turn = s.heading - prev.heading
  if (turn > Math.PI) turn -= 2 * Math.PI
  if (turn < -Math.PI) turn += 2 * Math.PI
  if (speed > 0.02) {
    const ahead = dx * Math.cos(s.heading) + dy * Math.sin(s.heading)
    return ahead >= 0 || s.kind === 'codeair' ? 'moving' : 'backing'
  }
  if (Math.abs(turn / dt) > 0.15) return turn > 0 ? 'turnLeft' : 'turnRight'
  return 'still'
}

// The whole board, in a sentence or three. `room` is the room's name as a
// sentence would use it.
export function describe(s, { room, motion: m = 'still' } = {}) {
  const device = NAMES[s.kind] ?? s.kind
  if (s.kind === 'codex') {
    return [
      t('describe.codex', { device }),
      t('describe.codexLights', { lit: lit(s.pixels), on: (s.leds ?? []).filter(Boolean).length }),
      t('describe.codexScreen'),
    ].join(' ')
  }
  const where = room ? t('describe.inRoom', { room }) : ''
  const at = t('describe.at', {
    x: fixed(Math.abs(s.x), 1), ew: t(s.x < 0 ? 'compass.west' : 'compass.east'),
    y: fixed(Math.abs(s.y), 1), ns: t(s.y < 0 ? 'compass.south' : 'compass.north'),
  })
  const facing = compass(s.heading)
  const parts = []
  if (s.kind === 'codeair') {
    const above = s.above ?? s.z
    const state = above > 0.02 ? t('describe.flying', { height: fixed(above, 1) }) : t('describe.resting')
    parts.push(t('describe.air', { device, where, state, at, facing }))
    const doing = m === 'moving' ? t('describe.airMoving') : m.startsWith('turn') ? t('describe.airTurning', { doing: t(`doing.${m}`) }) : ''
    parts.push(t('describe.motors', { motors: t(s.motors ? 'describe.motorsOn' : 'describe.motorsOff'), doing }))
    parts.push(t('describe.airPixels', { lit: lit(s.pixels) }))
  } else {
    const level = s.z > 0.01 ? t('describe.onFloor', { height: fixed(s.z, 1) }) : ''
    const pushing = s.blocked ? t('describe.pushing') : ''
    parts.push(t('describe.bot', { device, where, level, at, facing, doing: t(`doing.${m}`), pushing }))
    parts.push(t('describe.botLights', { on: bits(s.leds?.user ?? 0, 8) }))
  }
  if (s.tone) parts.push(t('describe.tone', { hz: Math.round(s.tone) }))
  return parts.join(' ')
}

// What changed between two moments that is worth saying out loud, or null.
export function change(prev, s, mPrev, m) {
  if (!prev) return null
  const said = []
  if (s.kind === 'codebot') {
    if (s.blocked && !prev.blocked) said.push(t('say.bumped'))
    if (s.z < prev.z - 0.05) said.push(t('say.fell'))
    if (mPrev === 'still' && m !== 'still') said.push(t(m === 'moving' ? 'say.driving' : `say.${m}`))
    if (mPrev !== 'still' && m === 'still' && !s.blocked) said.push(t('say.stopped'))
  } else if (s.kind === 'codeair') {
    const up = (x) => (x.above ?? x.z) > 0.02
    if (up(s) && !up(prev)) said.push(t('say.tookOff'))
    if (!up(s) && up(prev)) said.push(t('say.landed'))
  }
  return said.length ? said.join(' ') : null
}

// Keeps a view's description and announcements current from its frames.
export class Describer {
  // host: where the view is drawn; el: the view's focusable element.
  constructor(host, el, label) {
    this.desc = Object.assign(document.createElement('p'), { className: 'sim-sr', id: `sim-desc-${++Describer.n}` })
    this.say = Object.assign(document.createElement('p'), { className: 'sim-sr' })
    this.say.setAttribute('aria-live', 'polite')
    host.append(this.desc, this.say)
    el.setAttribute('aria-label', label)
    el.setAttribute('aria-describedby', this.desc.id)
    this.prev = null
    this.at = 0
    this.motion = 'still'
  }

  // A snapshot from the world; looked at no more than once a second.
  frame(snapshot, room) {
    const s = snapshot.devices[0]
    const now = performance.now()
    if (!s || now - this.at < 1000) return
    // simulated seconds, so a run at 4x reads as the same motion
    const dt = this.prev ? (snapshot.t - this.t) / 1e6 : 0
    const m = dt > 0 ? motion(this.prev, s, dt) : this.motion
    this.t = snapshot.t
    this.desc.textContent = describe(s, { room, motion: m })
    const said = change(this.prev, s, this.motion, m)
    if (said) this.say.textContent = said
    this.prev = s
    this.motion = m
    this.at = now
  }

  dispose() {
    this.desc.remove()
    this.say.remove()
  }
}
Describer.n = 0
