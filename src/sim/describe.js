// The simulated board in words, for a screen reader: what the picture shows.
//
// A description of the whole board, kept current (once a second) in an
// element the view points to with aria-describedby, read when the view has
// focus; and short announcements of what changed that matters (it started
// or stopped moving, bumped into something, dropped off a ledge, took off,
// landed), in a polite live region. Positions are never announced as they
// change: a stream of numbers drowns everything else out.
//
// The strings join the app's string table after the device-interface rebase.
const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']
const NAMES = { codebot: 'CodeBot', codex: 'CodeX', codeair: 'CodeAIR' }

export function compass(heading) {
  const i = Math.round(heading / (Math.PI / 4))
  return COMPASS[((i % 8) + 8) % 8]
}

const bits = (v, n) => { let c = 0; for (let i = 0; i < n; i++) if ((v >> i) & 1) c++; return c }
const lit = (pixels) => (pixels ?? []).filter(([r, g, b]) => r + g + b > 0).length

// What a board is doing between two snapshots `dt` seconds apart: its motion.
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
  if (Math.abs(turn / dt) > 0.15) return turn > 0 ? 'turning left' : 'turning right'
  return 'still'
}

// The whole board, in a sentence or three.
export function describe(s, { room, motion: m = 'still' } = {}) {
  const name = NAMES[s.kind] ?? s.kind
  if (s.kind === 'codex') {
    const parts = [`Simulated ${name}, held in the hand.`]
    parts.push(`${lit(s.pixels)} of 4 NeoPixels lit, ${(s.leds ?? []).filter(Boolean).length} of 6 red LEDs on.`)
    parts.push('What it prints shows in the terminal; its screen is a picture.')
    return parts.join(' ')
  }
  const where = room ? ` in the ${room}` : ''
  const at = `about ${Math.abs(s.x).toFixed(1)} m ${s.x < 0 ? 'west' : 'east'} and ${Math.abs(s.y).toFixed(1)} m ${s.y < 0 ? 'south' : 'north'} of the room's middle`
  const parts = []
  if (s.kind === 'codeair') {
    const above = s.above ?? s.z
    const state = above > 0.02 ? `flying ${above.toFixed(1)} m up` : 'resting'
    parts.push(`Simulated ${name}${where}, ${state}, ${at}, facing ${compass(s.heading)}.`)
    parts.push(`Motors ${s.motors ? 'on' : 'off'}${m === 'moving' ? ', moving' : m.startsWith('turning') ? `, ${m}` : ''}.`)
    parts.push(`${lit(s.pixels)} of 8 NeoPixels lit.`)
  } else {
    const level = s.z > 0.01 ? `, on a floor ${s.z.toFixed(1)} m up` : ''
    const doing = { still: 'standing still', moving: 'driving forward', backing: 'backing up' }[m] ?? m
    parts.push(`Simulated ${name}${where}${level}, ${at}, facing ${compass(s.heading)}, ${doing}${s.blocked ? ', pushing against something' : ''}.`)
    const leds = s.leds ?? {}
    parts.push(`${bits(leds.user ?? 0, 8)} of 8 user lights on.`)
  }
  if (s.tone) parts.push(`Its speaker plays ${Math.round(s.tone)} hertz.`)
  return parts.join(' ')
}

// What changed between two moments that is worth saying out loud, or null.
export function change(prev, s, mPrev, m) {
  if (!prev) return null
  const said = []
  if (s.kind === 'codebot') {
    if (s.blocked && !prev.blocked) said.push('Bumped into something.')
    if (s.z < prev.z - 0.05) said.push('Fell off the edge.')
    if (mPrev === 'still' && m !== 'still') said.push(m === 'backing' ? 'Backing up.' : m === 'moving' ? 'Driving.' : `${m[0].toUpperCase()}${m.slice(1)}.`)
    if (mPrev !== 'still' && m === 'still' && !s.blocked) said.push('Stopped.')
  } else if (s.kind === 'codeair') {
    const up = (x) => (x.above ?? x.z) > 0.02
    if (up(s) && !up(prev)) said.push('Took off.')
    if (!up(s) && up(prev)) said.push('Landed.')
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
