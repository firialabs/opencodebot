// The simulator's panel: the 3D view and its controls (camera, pause, step,
// speed, the board's buttons). It builds its own DOM inside `host`.
import './sim.css'
import { COURSES } from './world/courses.js'
import { KINDS, ROOMS } from './kinds.js'

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
      <div class="sim-bar" hidden>
        <span class="sim-group sim-cameras" data-for="codebot codeair"></span>
        <span class="sim-group" data-for="codebot codeair">
          <label title="The room it is in">🏫 <select class="sim-room" aria-label="Room"></select></label>
        </span>
        <span class="sim-group" data-for="codebot">
          <label title="A line course of black tape on the floor">〰️ <select class="sim-course" aria-label="Line course"></select></label>
        </span>
        <span class="sim-group" data-for="codex">
          <label title="Tilt left and right">↔ <input type="range" class="sim-tilt-x" min="-90" max="90" value="0"></label>
          <label title="Tilt toward and away">↕ <input type="range" class="sim-tilt-y" min="-90" max="90" value="0"></label>
          <label title="Light on the sensor (lux)">💡 <input type="range" class="sim-light" min="0" max="1000" value="250"></label>
        </span>
        <span class="sim-group">
          <button type="button" class="icon-btn sim-pause" title="Pause">⏸</button>
          <button type="button" class="icon-btn sim-step" title="Step: run a moment, then pause">⏭</button>
          <button type="button" class="icon-btn sim-step-line" title="Step one line: run your program to its next line, and pause there" aria-label="Step one line">⤵</button>
          <select class="sim-speed" title="Simulation speed"></select>
        </span>
        <span class="sim-group sim-buttons" data-for="codebot codeair">
          <button type="button" class="sim-board-btn" data-n="0" title="Button 0 on the board">BTN 0</button>
          <button type="button" class="sim-board-btn" data-n="1" title="Button 1 on the board">BTN 1</button>
        </span>
        <a class="sim-chip sim-boards" data-for="codex codeair" href="./boards.html" target="_blank" rel="noopener" title="More simulated boards, in a new tab: their radios hear this one">📡 More boards</a>
        <button type="button" class="icon-btn sim-reset" data-for="codebot codeair" title="Put it back at the start">↺</button>
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
      b.textContent = label
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
    const pause = q('.sim-pause')
    pause.addEventListener('click', () => {
      this.paused = !this.paused
      if (this.paused) sim.pause(); else sim.resume()
      pause.textContent = this.paused ? '▶' : '⏸'
      pause.title = this.paused ? 'Resume' : 'Pause'
    })
    q('.sim-step').addEventListener('click', () => {
      this.paused = true
      pause.textContent = '▶'
      sim.step()
    })
    // Step one line: from a stop, the program starts paused at its first line.
    q('.sim-step-line').addEventListener('click', () => {
      this.paused = true
      pause.textContent = '▶'
      pause.title = 'Resume'
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
      const down = (e) => { e.preventDefault(); b.classList.add('is-down'); sim.press(n, true) }
      const up = () => { if (b.classList.contains('is-down')) { b.classList.remove('is-down'); sim.press(n, false) } }
      b.addEventListener('pointerdown', down)
      b.addEventListener('pointerup', up)
      b.addEventListener('pointerleave', up)
    }

    sim.addEventListener('state', () => this.refresh())
    sim.addEventListener('device', () => this.refresh())
  }

  refresh() {
    const on = this.sim.isConnected
    this.stage.dataset.off = String(!on)
    this.bar.hidden = !on
    for (const el of this.bar.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(this.sim.targetId)
    this.courseSelect.disabled = this.roomSelect.disabled = this.sim.state === 'running'
    if (on) this.roomSelect.value = this.sim.room ?? KINDS[this.sim.targetId]?.env
    if (!on || this.sim.state !== 'running') {
      this.paused = false
      this.bar.querySelector('.sim-pause').textContent = '⏸'
    }
  }

  _camera(mode) {
    for (const b of this.bar.querySelectorAll('.sim-chip')) b.classList.toggle('is-active', b.dataset.mode === mode)
    this.sim.setCamera(mode)
  }
}
