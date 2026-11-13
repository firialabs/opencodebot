// The simulator's settings, one set per browser: the volume of each sound
// bus (and whether it is muted), realism (how much the page draws), and
// whether the frame rate shows over the view.
// Kept in localStorage; where that is unavailable (a private window, blocked
// site data) the defaults hold for the visit. Neither changes the world: a
// program runs the same at every setting (sim/DESIGN.md, sections 3 and 4).

const STORE = 'opencodebot.simSettings.v1'

export const BUSES = ['motors', 'speaker', 'effects', 'music']
export const REALISMS = ['auto', 'low', 'medium', 'high', 'ultra']

const DEFAULTS = {
  volume: { motors: 70, speaker: 80, effects: 70, music: 50 },   // 0 to 100
  muted: { motors: false, speaker: false, effects: false, music: false },
  realism: 'auto',
  autoLevel: null,         // where Auto last settled, to start there next time
  showFps: false,          // the frame rate and pace, over the view
}

function load() {
  const s = structuredClone(DEFAULTS)
  try {
    const saved = JSON.parse(localStorage.getItem(STORE))
    if (!saved || typeof saved !== 'object') return s
    for (const b of BUSES) {
      const v = Number(saved.volume?.[b])
      if (Number.isFinite(v)) s.volume[b] = Math.max(0, Math.min(100, Math.round(v)))
      if (typeof saved.muted?.[b] === 'boolean') s.muted[b] = saved.muted[b]
    }
    if (REALISMS.includes(saved.realism)) s.realism = saved.realism
    if (typeof saved.showFps === 'boolean') s.showFps = saved.showFps
    if (REALISMS.includes(saved.autoLevel) && saved.autoLevel !== 'auto') s.autoLevel = saved.autoLevel
  } catch {
    // unreadable or unavailable: the defaults
  }
  return s
}

class Settings extends EventTarget {
  constructor() {
    super()
    Object.assign(this, load())
  }

  // A bus's gain as the ear hears a slider: 0 at 0, 1 at 100, with a square
  // law between so half way sounds about half as loud.
  gain(bus) {
    return this.muted[bus] ? 0 : (this.volume[bus] / 100) ** 2
  }

  setVolume(bus, value) {
    this.volume[bus] = Math.max(0, Math.min(100, Math.round(value)))
    if (this.volume[bus] > 0) this.muted[bus] = false
    this._changed('sound')
  }

  setMuted(bus, on) {
    this.muted[bus] = !!on
    this._changed('sound')
  }

  setRealism(r) {
    if (!REALISMS.includes(r)) return
    this.realism = r
    this._changed('realism')
  }

  setShowFps(on) {
    this.showFps = !!on
    this._changed('showFps')
  }

  // Auto's own choice, remembered without telling anyone (it was the view
  // that chose it).
  setAutoLevel(level) {
    this.autoLevel = level
    this._save()
  }

  _changed(what) {
    this._save()
    this.dispatchEvent(new CustomEvent('change', { detail: what }))
  }

  _save() {
    try {
      const { volume, muted, realism, autoLevel, showFps } = this
      localStorage.setItem(STORE, JSON.stringify({ volume, muted, realism, autoLevel, showFps }))
    } catch {
      // not kept: the choice holds for this visit
    }
  }
}

export const settings = new Settings()
