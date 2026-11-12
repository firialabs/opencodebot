// The boards page: several simulated boards at once, each with its own
// program, picture and terminal. Each is a SimDevice with its own worker, so
// their radios hear each other (runtime/broadcast-air.js), as do boards in
// the app and in other tabs of this browser.
import '../../styles/theme.css'
import '../../styles/app.css'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'
import '../sim.css'
import './boards.css'
import { SimDevice } from '../sim-device.js'
import { holdButton } from '../hold-button.js'
import { boardButtonsHtml } from '../sim-panel.js'
import { t, tHtml, translatePage } from '../../i18n/index.js'
import { TerminalPanel } from '../../ui/terminal.js'
import { EXAMPLES, example, exampleFor } from './examples.js'

// The boards this build can simulate (CodeAIR only with its flight library).
const KINDS = [['codex', 'CodeX'], ['codeair', 'CodeAIR'], ['codebot', 'CodeBot']].filter(([id]) => SimDevice.canSimulate(id))
const STORE = 'opencodebot-boards'
const MAX_BOARDS = 6

const grid = document.getElementById('bd-grid')
translatePage()
if (!SimDevice.canSimulate('codeair')) document.querySelector('[data-i18n="boards.intro"]').textContent = t('boards.introNoFlight')
const addButton = document.getElementById('bd-add')
const boards = []

class Board {
  constructor({ kind, code }) {
    this.kind = kind
    this.sim = new SimDevice()
    this.el = document.createElement('section')
    this.el.className = 'bd-card'
    this.el.innerHTML = `
      <div class="bd-head">
        <div class="bd-title-row">
          <span class="bd-name"></span>
          <button type="button" class="bd-remove" title="${tHtml('boards.remove')}" aria-label="${tHtml('boards.remove')}">✕</button>
        </div>
        <select class="bd-kind" aria-label="${tHtml('boards.which')}">${KINDS.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select>
        <select class="bd-example" aria-label="${tHtml('boards.exampleLabel')}"></select>
        <button type="button" class="btn btn-run bd-run">${tHtml('boards.run')}</button>
        <button type="button" class="btn btn-stop bd-stop" disabled>${tHtml('boards.stop')}</button>
      </div>
      <div class="bd-stage" data-on="false">
        <div class="sim-view"></div>
        <div class="bd-off">${tHtml('boards.pressRun')}</div>
      </div>
      <div class="bd-bar" hidden>
        <span class="bd-buttons" role="group" aria-label="${tHtml('simPanel.buttons')}">
          ${boardButtonsHtml()}
        </span>
        <span class="bd-status" role="status"></span>
      </div>
      <textarea class="bd-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${tHtml('boards.program')}"></textarea>
      <div class="bd-term"></div>`
    const q = (s) => this.el.querySelector(s)
    this.kindSelect = q('.bd-kind')
    this.runButton = q('.bd-run')
    this.stopButton = q('.bd-stop')
    this.stage = q('.bd-stage')
    this.bar = q('.bd-bar')
    this.status = q('.bd-status')
    this.code = q('.bd-code')
    this.kindSelect.value = kind
    this.exampleSelect = q('.bd-example')
    this._fillExamples()
    this.exampleSelect.addEventListener('change', () => {
      const code = example(this.kind, this.exampleSelect.value)
      if (code) { this.code.value = code; save() }
      this.exampleSelect.value = ''
    })
    this.code.value = code ?? exampleFor(kind, boards.length)
    this.sim.attachView(q('.sim-view'))
    grid.appendChild(this.el)
    this.terminal = new TerminalPanel(q('.bd-term'), (data) => this.sim.sendRaw(data))

    this.sim.addEventListener('data', (e) => this.terminal.write(e.detail))
    this.sim.addEventListener('state', (e) => this._state(e.detail))
    this.sim.addEventListener('notice', (e) => this.terminal.warn(`${e.detail.title}. ${e.detail.detail ?? ''}`))
    this.runButton.addEventListener('click', () => this.run())
    this.stopButton.addEventListener('click', () => this.sim.stop())
    q('.bd-remove').addEventListener('click', () => this.remove())
    this.kindSelect.addEventListener('change', () => this.changeKind(this.kindSelect.value))
    this.code.addEventListener('input', save)
    this.code.addEventListener('keydown', (e) => indent(e, this.code))
    for (const b of this.el.querySelectorAll('.sim-board-btn')) {
      const n = Number(b.dataset.n)
      holdButton(b, (down) => this.sim.press(n, down))
    }
  }

  _fillExamples() {
    const s = this.exampleSelect
    s.replaceChildren(new Option(t('boards.examples'), ''))
    for (const [id, key] of EXAMPLES[this.kind] ?? []) {
      // a remote for a CodeAIR has nothing to steer without one
      if (id.startsWith('codeair-') && !SimDevice.canSimulate('codeair')) continue
      s.add(new Option(t(key), id))
    }
  }

  // Numbered by place, so the names stay 1, 2, 3 as boards come and go.
  name(n) {
    this.el.querySelector('.bd-name').textContent = t('boards.name', { n })
    this.el.setAttribute('aria-label', t('boards.name', { n }))
  }

  async run() {
    if (!this.sim.isConnected) {
      this.runButton.disabled = true
      const ok = await this.sim.connect(this.kind)
      this.runButton.disabled = false
      if (!ok) return
      this.stage.dataset.on = 'true'
      this.bar.hidden = false
      this.el.querySelector('.bd-buttons').hidden = this.kind === 'codex'   // CodeX's face has its own
    }
    this.terminal.say(t('boards.running'))
    await this.sim.run(this.code.value)
  }

  async changeKind(kind) {
    // The program follows the board while it is still the example.
    const wasExample = this.code.value === exampleFor(this.kind, boards.indexOf(this))
    await this.sim.disconnect()
    this.stage.dataset.on = 'false'
    this.bar.hidden = true
    this.kind = kind
    this._fillExamples()
    if (wasExample) this.code.value = exampleFor(kind, boards.indexOf(this))
    save()
  }

  async remove() {
    await this.sim.disconnect()
    this.el.remove()
    boards.splice(boards.indexOf(this), 1)
    renumber()
    save()
  }

  _state({ state, message }) {
    const running = state === 'running'
    this.stopButton.disabled = !running
    this.status.textContent = message ?? ''
  }
}

// Tab indents in the editor, as in any code editor; Escape first lets Tab
// move on to the next control.
let tabEscapes = false
function indent(e, ta) {
  if (e.key === 'Escape') { tabEscapes = true; return }
  if (e.key !== 'Tab' || tabEscapes || e.shiftKey) { tabEscapes = false; return }
  e.preventDefault()
  ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end')
  save()
}

function renumber() {
  boards.forEach((b, i) => b.name(i + 1))
  addButton.disabled = boards.length >= MAX_BOARDS
}

function add(spec) {
  boards.push(new Board(spec))
  renumber()
}

// The boards and their programs, kept in this browser between visits.
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(boards.map((b) => ({ kind: b.kind, code: b.code.value }))))
  } catch { /* storage blocked: the page still works, it just forgets */ }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE))
    const usable = Array.isArray(saved) ? saved.filter((b) => KINDS.some(([id]) => id === b?.kind)) : []
    if (usable.length) return usable.slice(0, MAX_BOARDS)
  } catch { /* nothing usable saved */ }
  return null
}

// ?boards=codex,codeair starts with those boards and their first examples;
// kind:example picks one (?boards=codex:codeair-remote,codeair:xfly).
const asked = new URLSearchParams(location.search).get('boards')?.split(',')
  .map((s) => s.split(':'))
  .filter(([k]) => KINDS.some(([id]) => id === k))
  .map(([kind, ex]) => ({ kind, code: (ex && example(kind, ex)) ?? undefined }))
const start = asked?.length ? asked : load() ?? [{ kind: 'codex' }, { kind: 'codex' }]
for (const spec of start.slice(0, MAX_BOARDS)) add(spec)
addButton.addEventListener('click', () => { add({ kind: 'codex' }); save() })
window.boards = boards       // for tests and the console
