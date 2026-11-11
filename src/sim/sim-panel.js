// The simulator's panel: the 3D view and its controls (camera, pause, step,
// speed, the board's buttons). It builds its own DOM inside `host`.
import './sim.css'
import { COURSES } from './world/courses.js'
import { KINDS, ROOMS } from './kinds.js'
import { holdButton } from './hold-button.js'

const CAMERAS = [['chase', '🎥 Follow'], ['orbit', '🔄 Orbit'], ['top', '🗺️ Top']]
const SPEEDS = [[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']]

export class SimPanel {
  constructor(host, sim, { onStart, onStepStart }) {
    this.sim = sim
    host.innerHTML = `
      <div class="sim-stage" data-off="true">
        <div class="sim-view"></div>
        <div class="sim-off">
          <p>Try your program on a simulated CodeBot, CodeX or CodeAIR. No cable needed!</p>
          <button type="button" class="btn btn-run sim-start">🎮 Start the simulator</button>
        </div>
      </div>
      <div class="sim-bar" role="toolbar" aria-label="Simulator" hidden>
        <span class="sim-group sim-cameras" data-for="codebot codeair" role="group" aria-label="Camera"></span>
        <span class="sim-group" data-for="codebot codeair">
          <label title="The room it is in"><span aria-hidden="true">🏫</span> <select class="sim-room" aria-label="Room"></select></label>
        </span>
        <span class="sim-group" data-for="codebot">
          <label title="A line course of black tape on the floor"><span aria-hidden="true">〰️</span> <select class="sim-course" aria-label="Line course"></select></label>
        </span>
        <span class="sim-group" data-for="codex">
          <label title="Tilt left and right"><span aria-hidden="true">↔</span> <input type="range" class="sim-tilt-x" min="-90" max="90" value="0" aria-label="Tilt left and right, degrees"></label>
          <label title="Tilt toward and away"><span aria-hidden="true">↕</span> <input type="range" class="sim-tilt-y" min="-90" max="90" value="0" aria-label="Tilt toward and away, degrees"></label>
          <label title="Light on the sensor (lux)"><span aria-hidden="true">💡</span> <input type="range" class="sim-light" min="0" max="1000" value="250" aria-label="Light on the sensor, lux"></label>
        </span>
        <span class="sim-group">
          <button type="button" class="icon-btn sim-pause" title="Pause" aria-label="Pause">⏸</button>
          <button type="button" class="icon-btn sim-step" title="Step: run a moment, then pause" aria-label="Step: run a moment, then pause">⏭</button>
          <button type="button" class="icon-btn sim-step-line" title="Step one line: run your program to its next line, and pause there" aria-label="Step one line">⤵</button>
          <select class="sim-speed" title="Simulation speed" aria-label="Simulation speed"></select>
        </span>
        <span class="sim-group sim-buttons" data-for="codebot codeair" role="group" aria-label="The board's buttons (hold Space or Enter)">
          <button type="button" class="sim-board-btn" data-n="0" title="Button 0 on the board" aria-label="Button 0">BTN 0</button>
          <button type="button" class="sim-board-btn" data-n="1" title="Button 1 on the board" aria-label="Button 1">BTN 1</button>
        </span>
        <a class="sim-chip sim-boards" data-for="codex codeair" href="./boards.html" target="_blank" rel="noopener" title="More simulated boards, in a new tab: their radios hear this one">📡 More boards</a>
        <button type="button" class="icon-btn sim-reset" data-for="codebot codeair" title="Put it back at the start" aria-label="Put it back at the start">↺</button>
      </div>`
    const q = (s) => host.querySelector(s)
    this.stage = q('.sim-stage')
    this.bar = q('.sim-bar')
    sim.attachView(q('.sim-view'))
    q('.sim-start').addEventListener('click', () => onStart())

    for (const [mode, label] of CAMERAS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sim-chip'
      b.dataset.mode = mode
      // the picture is for the eye; a screen reader says the word
      const [icon, word] = label.split(' ')
      b.append(Object.assign(document.createElement('span'), { textContent: icon }), ` ${word}`)
      b.firstChild.setAttribute('aria-hidden', 'true')
      b.addEventListener('click', () => this._camera(mode))
      q('.sim-cameras').appendChild(b)
    }
    this._camera('chase')

    const course = (this.courseSelect = q('.sim-course'))
    course.add(new Option('No course', ''))
    for (const [id, c] of Object.entries(COURSES)) course.add(new Option(c.name, id))
    course.addEventListener('change', () => sim.setCourse(course.value))

    const room = (this.roomSelect = q('.sim-room'))
    for (const [id, name] of Object.entries(ROOMS)) room.add(new Option(name, id))
    room.addEventListener('change', () => sim.setRoom(room.value))

    const speed = q('.sim-speed')
    for (const [v, label] of SPEEDS) speed.add(new Option(label, v, v === 1, v === 1))
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
    b.title = on ? 'Resume' : 'Pause'
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
