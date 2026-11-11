// The simulation engine: a world, and MicroPython running a program on the
// world's simulated time. It runs anywhere a module runs (a Web Worker, Node).
//
// How the program and the world share time (sim/DESIGN.md, section 1):
// - every `hookPeriod` backward branches the VM charges `usPerBranch` each to
//   the world, as the bytecodes would take on the device;
// - a device call (reading a sensor) charges what it costs on the device;
// - sleeping advances the world;
// - every ~16 ms of simulated or wall time the VM suspends (JSPI), and the
//   engine paces against the wall clock, hands the caller a frame, and lets
//   messages in (pause, step, stop).
//
// Each run gets a fresh VM, as the device soft-reboots before each program.

const FRAME_MS = 16

export class Engine {
  // opts:
  //   loadMicroPython  the loader from micropython.mjs
  //   wasmUrl          where micropython.wasm is (browser; Node finds it)
  //   world            a World
  //   bridge           (engine) => the `_sim` module object the shims call
  //   stopGraceUs      simulated time a stopped program has to clean up
  //   files            { 'botcore.py': source, ... } put on the VM's path
  //   speed            simulated seconds per wall second; Infinity = flat out
  //   usPerBranch      simulated microseconds charged per backward branch
  //   hookPeriod       branches between charges
  //   onOutput(bytes)  program output (Uint8Array)
  //   onFrame()        called at each suspension, at most every FRAME_MS wall
  //   onState(state, line)  'running' | 'paused' | 'idle', and the program's
  //                    line when paused (with `trace`)
  //   trace            report main.py's lines, for stepping by line (stepLine)
  //   lockstep, member  a Lockstep (lockstep.js) and this world's place on it:
  //                    several engines on one timeline (Node). Their VMs share
  //                    one JS realm, so each must come from its own copy of
  //                    micropython.mjs, and the engine swaps the globals the
  //                    port keeps its proxies in (REALM) as VMs take turns.
  constructor(opts) {
    this.o = opts
    this.world = opts.world
    this.speed = opts.speed ?? 1
    this.usPerBranch = opts.usPerBranch ?? 5   // an ESP32-S2 at 240 MHz; to be measured
    this.hookPeriod = opts.hookPeriod ?? 1000
    this.paused = false
    this.stepPending = false
    this.lineStepPending = false
    this.line = null          // main.py's line now (with `trace`)
    this.stopRequested = false
    this.running = false
    this.mp = null
    this._resume = null
    this._wake = null
    this._outBuf = []
    this._lastFrameWall = 0
  }

  now() {
    return globalThis.performance.now()
  }

  // --- time ------------------------------------------------------------------

  // Charge simulated time with no suspension (device calls, branch counts).
  charge(us) {
    if (us > 0) this.world.advance(us)
  }

  _shouldYield() {
    if (this._interruptDue() || this.paused || this.stepPending) return true
    if (this.now() - this._lastYieldWall >= FRAME_MS) return true
    if (isFinite(this.speed) && this.world.timeUs - this._lastYieldSim >= FRAME_MS * 1000 * this.speed) return true
    if (this.o.lockstep && this.world.timeUs >= this.o.lockstep.horizonUs) return true
    return false
  }

  // Suspended: other VMs in this realm may run until it resumes.
  async _yield() {
    if (!this.o.lockstep) return this._turn()
    this._leaveRealm()
    try {
      return await this._turn()
    } finally {
      this._enterRealm()
    }
  }

  _leaveRealm() {
    if (this.mp) this.mp.realm = Object.fromEntries(REALM.map((k) => [k, globalThis[k]]))
  }

  _enterRealm() {
    if (this.mp?.realm) Object.assign(globalThis, this.mp.realm)
  }

  // Pace, report, take messages.
  async _turn() {
    this._flushOutput()
    if (this._interruptDue()) return this._interrupt()
    if (this.stepPending) { this.stepPending = false; this.paused = true }
    if (this.paused) {
      this._frame(true)
      this.o.onState?.('paused', this.line)
      while (this.paused && !this.stopRequested) await new Promise((r) => (this._resume = r))
      this._resume = null
      if (this._interruptDue()) return this._interrupt()
      this.o.onState?.('running')
      this._rebase()
    }
    if (isFinite(this.speed)) {
      const due = this._wall0 + (this.world.timeUs - this._sim0) / 1000 / this.speed
      const ahead = due - this.now()
      if (ahead > 1) {
        await new Promise((r) => {
          const id = setTimeout(r, ahead)
          this._wake = () => { clearTimeout(id); r() }
        })
        this._wake = null
      } else {
        if (ahead < -250) this._rebase()      // fell behind (a slow machine): do not sprint to catch up
        await macrotask()
      }
    } else {
      await macrotask()
    }
    if (this.o.lockstep) await this.o.lockstep.wait(this.o.member)
    if (this._interruptDue()) return this._interrupt()
    this._lastYieldWall = this.now()
    this._lastYieldSim = this.world.timeUs
    this._frame(false)
  }

  async _delay(us) {
    // In frame-sized pieces, so the picture keeps moving through a long sleep.
    let left = us
    do {
      let piece = isFinite(this.speed) ? Math.min(left, FRAME_MS * 1000 * this.speed) : left
      if (this.o.lockstep) piece = Math.min(piece, Math.max(0, this.o.lockstep.horizonUs - this.world.timeUs))
      this.charge(piece)
      left -= piece
      this._raised = false
      await this._yield()
    } while (left > 0 && !this._raised)
  }

  _rebase() {
    this._wall0 = this.now()
    this._sim0 = this.world.timeUs
  }

  _frame(force) {
    const t = this.now()
    if (force || t - this._lastFrameWall >= FRAME_MS) {
      this._lastFrameWall = t
      this.o.onFrame?.()
    }
  }

  // A stop raises KeyboardInterrupt in the program at the next suspension,
  // once. A device whose program cleans up after it (CodeAIR lands, from a
  // `with recorder:` block) gets `stopGraceUs` of simulated time to finish;
  // after that, or at a second stop, it is raised at every suspension, and a
  // program that still carries on is cut off.
  _interruptDue() {
    if (!this.stopRequested) return false
    if (!this._interrupts || this._stopAgain) return true
    return this.world.timeUs - this._firstInterruptUs >= (this.o.stopGraceUs ?? 0)
  }

  _interrupt() {
    this.mp._module._mp_sched_keyboard_interrupt()
    this._raised = true
    this._interrupts = (this._interrupts ?? 0) + 1
    if (this._interrupts === 1) this._firstInterruptUs = this.world.timeUs
    else if (this._interrupts === 2) this._stopAt = this.now()
    if (this._interrupts > 3 && this.now() - this._stopAt > 300) {
      this._abandon?.()
      return new Promise(() => {})        // never resumes; the VM is dropped
    }
  }

  // --- output ------------------------------------------------------------------

  // Output from the device itself, not the program's print (a board's
  // console, say): it goes out with the program's.
  write(bytes) {
    this._out(bytes)
  }

  _out(bytes) {
    this._outBuf.push(bytes)
    if (this._outBuf.length > 256) this._flushOutput()
  }

  _flushOutput() {
    if (!this._outBuf.length) return
    let n = 0
    for (const b of this._outBuf) n += b.length
    const all = new Uint8Array(n)
    let o = 0
    for (const b of this._outBuf) { all.set(b, o); o += b.length }
    this._outBuf = []
    this.o.onOutput?.(all)
  }

  // --- running -------------------------------------------------------------------

  async _newVM() {
    const out = (b) => this._out(b)
    const mp = await this.o.loadMicroPython({
      url: this.o.wasmUrl,
      stdout: out, stderr: out, linebuffer: false,
      heapsize: 512 * 1024,
    })
    const M = mp._module
    if (this.o.lockstep && globalThis.Module !== M) throw new Error('another VM ran while this one loaded')
    // A VM that has been replaced (a stopped program that would not stop, a
    // REPL command cut off by Run) must never touch the world again: at its
    // next suspension it stops for good, and the garbage collector has it.
    const gen = (this.gen = (this.gen ?? 0) + 1)
    const live = () => gen === this.gen
    const never = () => new Promise(() => {})
    M.sim = {
      charge: (n) => {
        if (!live()) return 1
        this.charge(n * this.usPerBranch)
        return this._shouldYield() ? 1 : 0
      },
      advance: (us) => { if (live()) this.charge(us) },
      yield: () => (live() ? this._yield() : never()),
      delay: (us) => (live() ? this._delay(us) : never()),
      ticksUs: () => this.world.timeUs,
      timeMs: () => this.world.epochMs + this.world.timeUs / 1000,
      // A new line of main.py (with `trace`): 1 pauses there.
      line: (n) => {
        if (!live()) return 0
        this.line = n
        if (!this.lineStepPending) return 0
        this.lineStepPending = false
        this.paused = true
        return 1
      },
    }
    M._sim_set_hook_period(this.hookPeriod)
    try { mp.FS.mkdir('/lib') } catch { /* exists */ }
    for (const [name, src] of Object.entries(this.o.files ?? {})) {
      const dir = name.includes('/') ? '/lib/' + name.slice(0, name.lastIndexOf('/')) : null
      if (dir) mp.FS.mkdirTree(dir)
      mp.FS.writeFile('/lib/' + name, src)
    }
    const bridge = this.o.bridge(this)
    const guarded = {}
    for (const [k, f] of Object.entries(bridge)) {
      guarded[k] = (...a) => (live() ? f(...a) : 0)
    }
    mp.registerJsModule('_sim', guarded)
    if (this.o.lockstep) mp.realm = Object.fromEntries(REALM.map((k) => [k, globalThis[k]]))
    return mp
  }

  // Run a program to its end (or a stop). Resolves { ok, error, stopped }.
  // stepFirst (with `trace`): pause at its first line, to step from there.
  async run(source, { seed, stepFirst = false } = {}) {
    if (this.running) throw new Error('already running')
    this.running = true
    this.stopRequested = false
    this.paused = false
    this.stepPending = false
    this.lineStepPending = !!stepFirst
    this.line = null
    this._interrupts = 0
    this._stopAgain = false
    this.replVM = null
    this._replPending = 0
    this.mp = await this._newVM()
    this._enterRealm()
    this.mp.FS.writeFile('/main.py', source)
    this.mp.runPython(`import random\nrandom.seed(${(seed ?? 0) >>> 0})\ndel random`)
    this._rebase()
    this._lastYieldWall = this.now()
    this._lastYieldSim = this.world.timeUs
    this.o.onState?.('running')
    const abandoned = new Promise((r) => (this._abandon = () => r('abandoned')))
    let result
    try {
      const how = await Promise.race([
        this.mp.runPythonAsync(this.o.trace ? RUN_MAIN_TRACED : RUN_MAIN).then(() => 'done'),
        abandoned,
      ])
      result = how === 'abandoned' ? { ok: false, stopped: true } : { ok: true }
    } catch (e) {
      const text = String(e?.message ?? e)
      const stopped = /KeyboardInterrupt/.test(text)
      result = { ok: false, stopped, error: stopped ? null : parseTraceback(text) }
      if (!stopped) this._out(new TextEncoder().encode(cleanTraceback(text)))
    }
    this._flushOutput()
    this.running = false
    this._abandon = null
    this.o.onFrame?.()
    this.o.onState?.('idle')
    return result
  }

  // --- the REPL, between programs ------------------------------------------------

  get replBusy() {
    return (this._replPending ?? 0) > 0
  }

  // Characters typed at the terminal. A fresh VM starts at the first one, as
  // the device's REPL does after a program ends. Ctrl-C interrupts a command.
  async replInput(text) {
    if (this.running) return
    if (!this.replVM) {
      this._replStarting ??= (async () => {
        const mp = await this._newVM()
        mp.runPython(`import random\nrandom.seed(${Date.now() >>> 0})\ndel random`)
        mp.replInit()
        this.replVM = this.mp = mp
        this._flushOutput()
      })()
      await this._replStarting
      this._replStarting = null
    }
    for (const ch of text) {
      const code = ch.charCodeAt(0)
      if (code === 3 && this.replBusy) {
        this.stopRequested = true
        this._stopAt = this.now()
        this._resume?.()
        this._wake?.()
        continue
      }
      if (!this.replBusy) {
        this._rebase()
        this._lastYieldWall = this.now()
        this._lastYieldSim = this.world.timeUs
      }
      // Characters queue up behind a running command; the REPL is busy
      // until the last one is done.
      this._replPending = (this._replPending ?? 0) + 1
      const vm = this.mp
      this.mp.replProcessCharWithAsyncify(code).finally(() => {
        if (vm !== this.mp) return
        if (--this._replPending === 0) {
          this.stopRequested = false
          this._interrupts = 0
          this._stopAgain = false
        }
        this._flushOutput()
        this.o.onFrame?.()
      })
    }
    this._flushOutput()
  }

  stop() {
    if (!this.running) return
    if (this.stopRequested) this._stopAgain = true
    this.stopRequested = true
    this._stopAt = this.now()
    this._resume?.()
    this._wake?.()
  }

  pause() {
    this.paused = true
    this._wake?.()
  }

  resume() {
    this.paused = false
    this._resume?.()
  }

  step() {
    this.stepPending = true
    this.resume()
  }

  // Run on to the next line of main.py, and pause there (with `trace`).
  stepLine() {
    this.lineStepPending = true
    this.resume()
  }
}

// The globals MicroPython's web port keeps its JS proxies in.
const REALM = ['Module', 'proxy_js_ref', 'proxy_js_ref_next', 'proxy_js_ref_map', 'proxy_js_map',
  'proxy_js_existing', 'pyProxyFinalizationRegistry']

// Run /main.py as __main__, as the device runs its program file.
const RUN_MAIN = `
def __run():
    with open('/main.py') as f:
        src = f.read()
    exec(compile(src, 'main.py', 'exec'), {'__name__': '__main__'})
__run()
`
// The same, with main.py's lines reported (the trace is on for its frames only).
const RUN_MAIN_TRACED = RUN_MAIN.replace("    exec(", "    import _simtrace\n    _simtrace.on()\n    exec(")

// The traceback as the device would print it: without the frames of the
// runner above.
export function cleanTraceback(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const kept = lines.filter((l, i) => {
    if (!/^\s+File "<stdin>"/.test(l)) return true
    return false
  })
  let s = kept.join('\n')
  if (!s.endsWith('\n')) s += '\n'
  return s.replace(/\n/g, '\r\n')
}

// { name, message, line } of the error the program raised.
export function parseTraceback(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n')
  const last = lines[lines.length - 1] ?? ''
  const m = /^(\w+(?:\.\w+)*)(?::\s*(.*))?$/.exec(last.trim())
  let line = null
  for (const l of lines) {
    const f = /File "main\.py", line (\d+)/.exec(l)
    if (f) line = Number(f[1])
  }
  return { name: m?.[1] ?? 'Error', message: m?.[2] ?? last, line }
}

// A fresh macrotask (so messages get in), without setTimeout's clamping.
function macrotask() {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { ch.port1.close(); resolve() }
    ch.port2.postMessage(0)
  })
}
