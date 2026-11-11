// Runtime glue: MicroPython (sim variant) + a toy world, in one thread.
// Works in Node and in a module Worker.
export function makeWorld() {
  // Differential-drive robot, 1 ms physics step.
  const w = { x: 0, y: 0, th: 0, l: 0, r: 0, en: true, steps: 0 };
  w.step = (ms) => {
    for (let i = 0; i < ms; i++) {
      const vl = w.en ? w.l * 0.003 : 0, vr = w.en ? w.r * 0.003 : 0; // m/s per pct
      const v = (vl + vr) / 2, om = (vr - vl) / 0.1;
      w.x += v * Math.cos(w.th) * 0.001; w.y += v * Math.sin(w.th) * 0.001; w.th += om * 0.001;
      w.steps++;
    }
  };
  w.setMotor = (which, pct) => { if (which === 0) w.l = pct; else w.r = pct; };
  w.enableMotors = (on) => { w.en = on; };
  w.lineSensor = (n) => Math.round(2000 + 1000 * Math.sin(w.x * 40 + n)) ;
  return w;
}

const tick = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); res(); }; c.port2.postMessage(0); });
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export async function makeSim(loadMicroPython, opts = {}) {
  const world = makeWorld();
  const s = {
    world, simUs: 0, usPerBranch: opts.usPerBranch ?? 2, speed: opts.speed ?? 1, // speed: sim/wall, Infinity = flat out
    period: opts.period ?? 1000, yieldEveryMs: opts.yieldEveryMs ?? 16,
    paused: false, stopReq: false, yields: 0, sleeps: 0, charges: 0,
    wall0: 0, sim0: 0, lastYieldWall: 0, onFrame: opts.onFrame || null, resume: null,
  };
  let out = [];
  const mp = await loadMicroPython({ ...(opts.mpOpts || {}), stdout: (l) => { out.push(l); opts.stdout?.(l); }, stderr: (l) => { out.push(l); opts.stdout?.(l); } });
  const M = mp._module;
  globalThis.world = world; mp.registerJsModule?.("world", world);
  const advance = (us) => { // step physics on whole-ms boundaries
    const before = Math.floor(s.simUs / 1000); s.simUs += us; const after = Math.floor(s.simUs / 1000);
    if (after > before) world.step(after - before);
  };
  const pace = async () => {
    if (s.stopReq) M._mp_sched_keyboard_interrupt();
    if (s.stepPending) { s.stepPending = false; s.paused = true; }
    if (s.paused) { while (s.paused && !s.stopReq) { await new Promise((r) => (s.resume = r)); } s.wall0 = performance.now(); s.sim0 = s.simUs; }
    if (s.stopReq) { M._mp_sched_keyboard_interrupt(); return; }
    if (isFinite(s.speed)) {
      const due = s.wall0 + (s.simUs - s.sim0) / 1000 / s.speed; const now = performance.now();
      if (due - now > 1) { await new Promise((r) => { const id = setTimeout(r, due - now); s.wake = () => { clearTimeout(id); r(); }; }); s.wake = null; }
      else { await tick(); }
    } else { await tick(); }
    s.lastYieldWall = performance.now(); s.lastYieldSim = s.simUs; s.yields++;
    s.onFrame?.(s);
  };
  M.simTicksMs = () => Math.floor(s.simUs / 1000);
  M.simCharge = (n) => { s.charges++; advance(n * s.usPerBranch); return (performance.now() - s.lastYieldWall > s.yieldEveryMs || (isFinite(s.speed) && s.simUs - s.lastYieldSim > s.yieldEveryMs * 1000 * s.speed) || s.stopReq || s.paused) ? 1 : 0; };
  M.simYield = pace;
  M.simSleep = async (ms) => { s.sleeps++; advance(ms * 1000); await pace(); };
  M._sim_set_hook_period(s.period);
  s.mp = mp; s.M = M; s.out = out;
  s.setPeriod = (n) => M._sim_set_hook_period(n);
  s.run = async (code) => {
    s.wall0 = performance.now(); s.sim0 = s.simUs; s.lastYieldWall = s.wall0; s.lastYieldSim = s.simUs; s.stopReq = false;
    try { await mp.runPythonAsync(code); return { ok: true }; }
    catch (e) { return { ok: false, err: String(e.message || e).split("\n").slice(-2).join(" ") }; }
  };
  s.stop = () => { s.stopReq = true; if (s.resume) s.resume(); if (s.wake) s.wake(); };
  s.step = () => { s.stepPending = true; s.unpause(); };
  s.pause = () => { s.paused = true; if (s.wake) s.wake(); };
  s.unpause = () => { s.paused = false; if (s.resume) { const r = s.resume; s.resume = null; r(); } };
  return s;
}
