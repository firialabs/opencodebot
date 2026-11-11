// CodeX as drawn: its screen, D-pad and A/B buttons, NeoPixels and LEDs, in
// 2D: crisp at any size and cheap on a Chromebook. Same face as SimView for
// SimDevice (push frames, dispose). The screen can go full screen for a class,
// with the keyboard as the buttons.
//
// Keys: arrows for the D-pad, A or Z for A, B or X for B, while the face (or
// the full screen) has focus, so typing in the editor never presses a button.
const BUTTONS = ['U', 'R', 'D', 'L', 'A', 'B']          // BTN_U .. BTN_B = 0 .. 5
const KEYS = {
  ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
  a: 4, A: 4, z: 4, Z: 4, b: 5, B: 5, x: 5, X: 5,
}

export class CodeXFace {
  constructor(host, { onButton }) {
    this.onButton = onButton
    this.el = document.createElement('div')
    this.el.className = 'cx-wrap'
    this.el.tabIndex = 0
    this.el.innerHTML = `
      <div class="cx-body">
        <div class="cx-pixels">${'<span class="cx-pixel"></span>'.repeat(4)}</div>
        <div class="cx-screen-frame"><canvas class="cx-screen" width="240" height="240"></canvas></div>
        <div class="cx-controls">
          <div class="cx-dpad">
            ${['U', 'L', 'R', 'D'].map((b) => `<button type="button" class="cx-btn cx-${b}" data-b="${BUTTONS.indexOf(b)}" aria-label="${b}"></button>`).join('')}
          </div>
          <div class="cx-ab">
            <button type="button" class="cx-btn cx-B" data-b="5">B</button>
            <button type="button" class="cx-btn cx-A" data-b="4">A</button>
          </div>
        </div>
        <div class="cx-leds">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="cx-led" data-led="${i}"></span>`).join('')}</div>
        <button type="button" class="cx-full" title="Full screen (Esc to leave)">⛶ Full screen</button>
        <div class="cx-hint">Keys: arrows, A, B</div>
      </div>`
    host.appendChild(this.el)
    this.canvas = this.el.querySelector('.cx-screen')
    this.ctx = this.canvas.getContext('2d')
    this.image = this.ctx.createImageData(240, 240)
    this.pixels = [...this.el.querySelectorAll('.cx-pixel')]
    this.leds = [...this.el.querySelectorAll('.cx-led')]
    this.down = new Set()

    for (const b of this.el.querySelectorAll('.cx-btn')) {
      const n = Number(b.dataset.b)
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this._press(n, true); this.el.focus() })
      b.addEventListener('pointerup', () => this._press(n, false))
      b.addEventListener('pointerleave', () => this._press(n, false))
    }
    this._key = (e) => {
      const n = KEYS[e.key]
      if (n === undefined || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      if (e.type === 'keydown' && e.repeat) return
      this._press(n, e.type === 'keydown')
    }
    this.el.addEventListener('keydown', this._key)
    this.el.addEventListener('keyup', this._key)
    this.el.addEventListener('blur', () => { for (const n of [...this.down]) this._press(n, false) })
    this.el.querySelector('.cx-full').addEventListener('click', () => this.fullScreen())
  }

  fullScreen() {
    const f = this.el.requestFullscreen?.() ?? this.el.webkitRequestFullscreen?.()
    Promise.resolve(f).then(() => this.el.focus()).catch(() => {})
  }

  _press(n, down) {
    if (down === this.down.has(n)) return
    if (down) this.down.add(n); else this.down.delete(n)
    this.el.querySelector(`.cx-btn[data-b="${n}"]`)?.classList.toggle('is-down', down)
    this.onButton(n, down)
  }

  // The view interface SimDevice uses.
  async loadRoom() {}
  async addDevice(snap) { this.update(snap) }
  setCamera() {}
  resize() {}

  push(frame) {
    const s = frame.devices[0]
    if (s) this.update(s)
  }

  // A new picture for the screen: RGB565 pixels.
  screen(px) {
    const d = this.image.data
    for (let i = 0; i < px.length; i++) {
      const c = px[i]
      const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f
      d[i * 4] = (r << 3) | (r >> 2)
      d[i * 4 + 1] = (g << 2) | (g >> 4)
      d[i * 4 + 2] = (b << 3) | (b >> 2)
      d[i * 4 + 3] = 255
    }
    this.ctx.putImageData(this.image, 0, 0)
  }

  update(s) {
    s.pixels?.forEach(([r, g, b], i) => {
      const p = this.pixels[i]
      if (!p) return
      const lit = r + g + b > 0
      p.style.background = lit ? `rgb(${r},${g},${b})` : ''
      p.style.boxShadow = lit ? `0 0 12px 3px rgba(${r},${g},${b},0.7)` : ''
    })
    s.leds?.forEach((on, i) => this.leds[i]?.classList.toggle('is-on', !!on))
    this.canvas.style.filter = s.brightness < 100 ? `brightness(${Math.max(0.05, s.brightness / 100)})` : ''
  }

  dispose() {
    if (document.fullscreenElement === this.el) document.exitFullscreen?.()
    this.el.remove()
  }
}
