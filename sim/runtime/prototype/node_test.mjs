import { makeSim } from "./simrt.mjs";
import { BENCH, SLEEPY, TIGHT } from "./progs.mjs";
const B = "../mpsrc/ports/webassembly/";
const { loadMicroPython: loadSim } = await import(B + "build-sim/micropython.mjs");
const { loadMicroPython: loadBrowser } = await import(B + "build-browser/micropython.mjs");
const log = (...a) => console.log(...a);
const t = async (fn) => { const a = performance.now(); const r = await fn(); return [Math.round(performance.now() - a), r]; };

// 1. CPU bench: browser (no hook) vs sim with various hook periods
{ const mp = await loadBrowser({}); mp.runPython(BENCH);
  for (let k = 0; k < 3; k++) log("browser(no hook) bench ms", (await t(() => mp.runPythonAsync("run()")))[0]); }
for (const [period, speed] of [[0, Infinity], [100000, Infinity], [1000, Infinity], [100, Infinity], [10, Infinity], [1, Infinity]]) {
  const s = await makeSim(loadSim, { period, speed });
  await s.run(BENCH);
  const r = []; for (let k = 0; k < 3; k++) r.push((await t(() => s.run("run()")))[0]);
  log(`sim period=${period} bench ms`, r.join(","), "charges", s.charges, "yields", s.yields, "sim s", (s.simUs / 1e6).toFixed(2));
}
// 2. sleepy loop, 200 x 0.1 s = 20 sim s, flat out and at 10x
for (const speed of [Infinity, 10]) {
  const s = await makeSim(loadSim, { speed });
  const [ms, r] = await t(() => s.run(SLEEPY));
  log(`sleepy speed=${speed}: wall ms ${ms}, sim s ${(s.simUs/1e6).toFixed(3)}, sleeps ${s.sleeps}, yields ${s.yields}, pose`, s.world.x.toFixed(4), s.world.y.toFixed(4), r.ok ? "" : r.err);
}
// 3. tight loop: stop by message after 300 ms wall; pause/unpause
{ const s = await makeSim(loadSim, { speed: 1 });
  let stopAt; setTimeout(() => s.pause(), 200); setTimeout(() => { s.unpause(); }, 400);
  setTimeout(() => { stopAt = performance.now(); s.stop(); }, 700);
  const r = await s.run(TIGHT); const lat = performance.now() - stopAt;
  log("tight speed=1: result", JSON.stringify(r), "stop latency ms", lat.toFixed(1), "sim s", (s.simUs/1e6).toFixed(3), "yields", s.yields, "n", s.mp.globals.get("n"));
  // can we run again after a stop without reloading?
  const r2 = await s.run("print('alive after stop', n)"); log(JSON.stringify(r2), s.out.slice(-1)[0]);
}
// 4. suspension cost: 20000 x sleep(0)
{ const s = await makeSim(loadSim, { speed: Infinity });
  const [ms] = await t(() => s.run("import time\nfor i in range(20000):\n    time.sleep(0)"));
  log("20000 sleep(0) suspends: ms", ms, "us each", (ms * 1000 / 20000).toFixed(1)); }
// 5. determinism: two runs, same pose bits and sim time
{ const res = [];
  for (let k = 0; k < 2; k++) { const s = await makeSim(loadSim, { speed: Infinity, period: 1000 });
    await s.run(`from botcore import *
import random
random.seed(1)
d = {}
for i in range(3000):
    d[str(i)+'x'] = i
    v = ls.read(0) + random.randint(0, 5)
    motors.run(LEFT, v % 100)
    motors.run(RIGHT, (v * 7) % 100)
    s = sum(j for j in range(i % 50))
ks = ''.join(list(d.keys())[:5])`);
    res.push([s.world.x, s.world.y, s.world.th, s.simUs, s.mp.globals.get("ks")]); }
  log("determinism", JSON.stringify(res[0]) === JSON.stringify(res[1]), JSON.stringify(res[0])); }
process.exit(0);
