// The simulator's panel: the 3D view and its controls (camera, pause, step,
// speed, the board's buttons). It builds its own DOM inside `host`.
import './sim.css'
import { COURSES } from './world/courses.js'
import { KINDS, ROOMS } from './kinds.js'
import { holdButton } from './hold-button.js'
import { t, tHtml } from '../i18n/index.js'

const CAMERAS = [['chase', '🎥', 'simPanel.camChase'], ['orbit', '🔄', 'simPanel.camOrbit'], ['top', '🗺️', 'simPanel.camTop']]
const SPEEDS = [0.5, 1, 2, 4]

// A board's two buttons (BTN 0 and 1), as the panel and the boards page show them.
export function boardButtonsHtml() {
  return [0, 1].map((n) => `<button type="button" class="sim-board-btn" data-n="${n}" title="${tHtml('simPanel.buttonTitle', { n })}" aria-label="${tHtml('simPanel.button', { n })}">${tHtml('simPanel.buttonFace', { n })}</button>`).join('\n')
}

export class SimPanel {
  constructor(host, sim, { onStart, onStepStart }) {
    this.sim = sim
    // title and aria-label from one key
    const both = (key) => `title="${tHtml(key)}" aria-label="${tHtml(key)}"`
    host.innerHTML = `
      <div class="sim-stage" data-off="true">
        <div class="sim-view"></div>
        <div class="sim-off">
          <p>${tHtml('simPanel.intro')}</p>
          <button type="button" class="btn btn-run sim-start">${tHtml('simPanel.start')}</button>
        </div>
      </div>
      <div class="sim-bar" role="toolbar" aria-label="${tHtml('simPanel.bar')}" hidden>
        <span class="sim-group sim-cameras" data-for="codebot codeair" role="group" aria-label="${tHtml('simPanel.camera')}"></span>
        <span class="sim-group" data-for="codebot codeair">
          <label title="${tHtml('simPanel.roomTitle')}"><span aria-hidden="true">🏫</span> <select class="sim-room" aria-label="${tHtml('simPanel.room')}"></select></label>
        </span>
        <span class="sim-group" data-for="codebot">
          <label title="${tHtml('simPanel.courseTitle')}"><span aria-hidden="true">〰️</span> <select class="sim-course" aria-label="${tHtml('simPanel.course')}"></select></label>
        </span>
        <span class="sim-group" data-for="codex">
          <label title="${tHtml('simPanel.tiltXTitle')}"><span aria-hidden="true">↔</span> <input type="range" class="sim-tilt-x" min="-90" max="90" value="0" aria-label="${tHtml('simPanel.tiltX')}"></label>
          <label title="${tHtml('simPanel.tiltYTitle')}"><span aria-hidden="true">↕</span> <input type="range" class="sim-tilt-y" min="-90" max="90" value="0" aria-label="${tHtml('simPanel.tiltY')}"></label>
          <label title="${tHtml('simPanel.lightTitle')}"><span aria-hidden="true">💡</span> <input type="range" class="sim-light" min="0" max="1000" value="250" aria-label="${tHtml('simPanel.light')}"></label>
        </span>
        <span class="sim-group">
          <button type="button" class="icon-btn sim-pause" ${both('simPanel.pause')}>⏸</button>
          <button type="button" class="icon-btn sim-step" ${both('simPanel.step')}>⏭</button>
          <button type="button" class="icon-btn sim-step-line" title="${tHtml('simPanel.stepLineTitle')}" aria-label="${tHtml('simPanel.stepLine')}">⤵</button>
          <select class="sim-speed" ${both('simPanel.speed')}></select>
        </span>
        <span class="sim-group sim-buttons" data-for="codebot codeair" role="group" aria-label="${tHtml('simPanel.buttons')}">
          ${boardButtonsHtml()}
        </span>
        <a class="sim-chip sim-boards" data-for="codex codeair" href="./boards.html" target="_blank" rel="noopener" title="${tHtml('simPanel.moreBoardsTitle')}">${tHtml('simPanel.moreBoards')}</a>
        <button type="button" class="icon-btn sim-reset" data-for="codebot codeair" ${both('simPanel.reset')}>↺</button>
      </div>`
    const q = (s) => host.querySelector(s)
    this.stage = q('.sim-stage')
    this.bar = q('.sim-bar')
    sim.attachView(q('.sim-view'))
    q('.sim-start').addEventListener('click', () => onStart())

    for (const [mode, icon, key] of CAMERAS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sim-chip'
      b.dataset.mode = mode
      // the picture is for the eye; a screen reader says the word
      b.append(Object.assign(document.createElement('span'), { textContent: icon }), ` ${t(key)}`)
      b.firstChild.setAttribute('aria-hidden', 'true')
      b.addEventListener('click', () => this._camera(mode))
      q('.sim-cameras').appendChild(b)
    }
    this._camera('chase')

    const course = (this.courseSelect = q('.sim-course'))
    course.add(new Option(t('simPanel.noCourse'), ''))
    for (const [id, c] of Object.entries(COURSES)) course.add(new Option(c.name, id))
    course.addEventListener('change', () => sim.setCourse(course.value))

    const room = (this.roomSelect = q('.sim-room'))
    for (const [id, name] of Object.entries(ROOMS)) room.add(new Option(name, id))
    room.addEventListener('change', () => sim.setRoom(room.value))

    const speed = q('.sim-speed')
    for (const v of SPEEDS) speed.add(new Option(t('simPanel.speedValue', { speed: v === 0.5 ? '½' : v }), v, v === 1, v === 1))
    speed.addEventListener('change', () => sim.setSpeed(Number(speed.value)))

    this.paused = false
    const pause = (this.pauseButton = q('.sim-pause'))
    pause.addEventListener('click', () => {
      if (this.paused) sim.resume(); else sim.pause()
      this._paused(!this.paused)
    })
    q('.sim-step').addEventListener('click', () => {
      this._paused(true)
      sim.step()
    })
    // Step one line: from a stop, the program starts paused at its first line.
    q('.sim-step-line').addEventListener('click', () => {
      this._paused(true)
      if (sim.state === 'running') sim.stepLine()
      else onStepStart?.()
    })
    q('.sim-reset').addEventListener('click', () => sim.reset())
    const tilt = () => sim.tilt((Number(q('.sim-tilt-x').value) * Math.PI) / 180, (Number(q('.sim-tilt-y').value) * Math.PI) / 180)
    q('.sim-tilt-x').addEventListener('input', tilt)
    q('.sim-tilt-y').addEventListener('input', tilt)
    q('.sim-light').addEventListener('input', () => sim.setLight(Number(q('.sim-light').value)))

    for (const b of host.querySelectorAll('.sim-board-btn')) {
      const n = Number(b.dataset.n)
      holdButton(b, (down) => sim.press(n, down))
    }

    sim.addEventListener('state', () => this.refresh())
    sim.addEventListener('device', () => this.refresh())
    sim.addEventListener('camera', (e) => this._chips(e.detail))
  }

  // The pause button says what it will do: pause, or resume.
  _paused(on) {
    this.paused = on
    const b = this.pauseButton
    b.textContent = on ? '▶' : '⏸'
    b.title = t(on ? 'simPanel.resume' : 'simPanel.pause')
    b.setAttribute('aria-label', b.title)
  }

  refresh() {
    const on = this.sim.isConnected
    this.stage.dataset.off = String(!on)
    this.bar.hidden = !on
    for (const el of this.bar.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(this.sim.targetId)
    this.courseSelect.disabled = this.roomSelect.disabled = this.sim.state === 'running'
    if (on) this.roomSelect.value = this.sim.room ?? KINDS[this.sim.targetId]?.env
    if (!on || this.sim.state !== 'running') this._paused(false)
  }

  _camera(mode) {
    this._chips(mode)
    this.sim.setCamera(mode)
  }

  _chips(mode) {
    for (const b of this.bar.querySelectorAll('.sim-cameras .sim-chip')) {
      b.classList.toggle('is-active', b.dataset.mode === mode)
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
    }
  }
}
