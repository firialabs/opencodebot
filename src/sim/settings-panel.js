// The simulator's settings: a panel over the view, opened from the gear on
// the simulator's bar. Sound (a slider and a mute for each bus), realism,
// and the frame rate. Every choice goes to settings.js, which keeps it and
// tells the speaker and the view.
import { settings, BUSES, REALISMS } from './settings.js'
import { t, tHtml, fixed } from '../i18n/index.js'

let made = 0
const NARROW = '(max-width: 600px), (max-height: 500px)'   // as in sim.css

export class SettingsPanel {
  // stage: the element over which the panel and the frame-rate readout sit;
  // gear: the button that opens it; sim: the SimDevice.
  constructor(stage, gear, sim) {
    this.sim = sim
    this.gear = gear
    this.stage = stage
    const id = `sim-settings-${++made}`
    const el = (this.el = document.createElement('div'))
    el.className = 'sim-settings'
    el.id = id
    el.hidden = true
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-labelledby', `${id}-title`)
    el.innerHTML = `
      <div class="sim-settings-head">
        <h2 id="${id}-title">${tHtml('settings.title')}</h2>
        <button type="button" class="icon-btn sim-settings-close" title="${tHtml('settings.close')}" aria-label="${tHtml('settings.close')}">✕</button>
      </div>
      <fieldset>
        <legend>${tHtml('settings.sound')}</legend>
        ${BUSES.map((b) => `
        <div class="sim-vol" data-bus="${b}"${b === 'music' ? ' hidden' : ''}>
          <label for="${id}-${b}">${tHtml(`settings.${b}`)}<small id="${id}-${b}-hint">${tHtml(`settings.${b}Hint`)}</small></label>
          <input type="range" id="${id}-${b}" min="0" max="100" step="5" aria-describedby="${id}-${b}-hint">
          <button type="button" class="icon-btn sim-mute" aria-pressed="false" aria-label="${tHtml('settings.mute', { bus: t(`settings.${b}`) })}" title="${tHtml('settings.mute', { bus: t(`settings.${b}`) })}"></button>
          ${b === 'music' ? '<p class="sim-credit"></p>' : ''}
        </div>`).join('')}
      </fieldset>
      <fieldset>
        <legend>${tHtml('settings.realism')}</legend>
        <div class="sim-realism-row">
          <label for="${id}-realism">${tHtml('settings.detail')}</label>
          <select id="${id}-realism" class="sim-realism" aria-describedby="${id}-note"></select>
        </div>
        <p class="sim-settings-note" id="${id}-note">${tHtml('settings.realismNote')}</p>
        <p class="sim-pace"></p>
        <label class="sim-check"><input type="checkbox" class="sim-show-fps"> ${tHtml('settings.showFps')}</label>
      </fieldset>`
    stage.appendChild(el)

    // the readout over the view, for the eye (the panel reads it out in words)
    this.overlay = document.createElement('div')
    this.overlay.className = 'sim-perf'
    this.overlay.setAttribute('aria-hidden', 'true')
    this.overlay.hidden = true
    stage.appendChild(this.overlay)

    const q = (s) => el.querySelector(s)
    for (const row of el.querySelectorAll('.sim-vol')) {
      const bus = row.dataset.bus
      const range = row.querySelector('input')
      range.addEventListener('input', () => settings.setVolume(bus, Number(range.value)))
      row.querySelector('.sim-mute').addEventListener('click', () => settings.setMuted(bus, !settings.muted[bus]))
    }
    this.realism = q('.sim-realism')
    for (const r of REALISMS) this.realism.add(new Option('', r))
    this.realism.addEventListener('change', () => settings.setRealism(this.realism.value))
    q('.sim-show-fps').addEventListener('change', (e) => settings.setShowFps(e.target.checked))
    q('.sim-settings-close').addEventListener('click', () => this.close())
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close() }
    })

    gear.setAttribute('aria-haspopup', 'dialog')
    gear.setAttribute('aria-expanded', 'false')
    gear.setAttribute('aria-controls', id)
    gear.addEventListener('click', () => (el.hidden ? this.open() : this.close()))

    settings.addEventListener('change', () => this.refresh())
    sim.addEventListener('music', () => this.refresh())
    this.refresh()
  }

  open() {
    // on a phone the view is a strip: the panel goes over the whole page
    // (sim.css), out of the stage's stacking
    const narrow = globalThis.matchMedia?.(NARROW).matches
    const home = narrow ? document.body : this.stage
    if (this.el.parentNode !== home) home.appendChild(this.el)
    this.el.hidden = false
    this.gear.setAttribute('aria-expanded', 'true')
    this.refresh()
    this.el.querySelector('input').focus()
  }

  // focus: back to the gear (not when the simulator closes under it)
  close({ focus = true } = {}) {
    if (this.el.hidden) return
    this.el.hidden = true
    this.gear.setAttribute('aria-expanded', 'false')
    this.refresh()
    if (focus) this.gear.focus()
  }

  // Show what the settings hold, and whether there is music to set.
  refresh() {
    for (const row of this.el.querySelectorAll('.sim-vol')) {
      const bus = row.dataset.bus
      const range = row.querySelector('input')
      range.value = settings.volume[bus]
      range.setAttribute('aria-valuetext', t('settings.percent', { value: settings.volume[bus] }))
      const mute = row.querySelector('.sim-mute')
      mute.setAttribute('aria-pressed', String(settings.muted[bus]))
      mute.textContent = settings.muted[bus] || settings.volume[bus] === 0 ? '🔇' : '🔊'
      row.classList.toggle('is-muted', settings.muted[bus])
    }
    const music = this.el.querySelector('[data-bus="music"]')
    music.hidden = !this.sim.music
    music.querySelector('.sim-credit').textContent = this.sim.musicCredit ?? ''
    this.realism.value = settings.realism
    this.el.querySelector('.sim-show-fps').checked = settings.showFps
    this._readout()
    // the readouts change by the second, while anyone can see them
    const ticking = !this.el.hidden || settings.showFps
    if (ticking && !this._timer) this._timer = setInterval(() => this._readout(), 500)
    else if (!ticking && this._timer) { clearInterval(this._timer); this._timer = null }
  }

  // The level Auto is at, the frame rate and the pace.
  _readout() {
    const view = this.sim.view
    const level = (l) => t(`settings.level.${l}`)
    for (const o of this.realism.options) o.text = o.value === 'auto' ? t('settings.realismAuto', { level: level(view?.level ?? settings.autoLevel ?? 'medium') }) : level(o.value)
    const on = this.sim.isConnected
    const fps = view?.fps ?? null
    const pace = fixed(this.sim.pace ?? 1, 1)
    this.el.querySelector('.sim-pace').textContent = !on ? '' : fps === null ? t('settings.paceRest', { pace }) : t('settings.pace', { fps: Math.round(fps), pace })
    this.overlay.hidden = !(on && settings.showFps)
    this.overlay.textContent = t('settings.overlay', { fps: fps === null ? '–' : Math.round(fps), pace })
  }
}
