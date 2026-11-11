import { makeSim } from "./simrt.mjs";
const B = "../mpsrc/ports/webassembly/build-sim/";
const t0 = performance.now();
const { loadMicroPython } = await import(B + "micropython.min.mjs");
let lastPost = 0;
const s = await makeSim(loadMicroPython, { speed: 1, mpOpts: { url: B + "micropython.wasm" },
  stdout: (l) => postMessage({ t: "out", l }),
  onFrame: (s) => { const now = performance.now(); if (now - lastPost > 16) { lastPost = now; const w = s.world; postMessage({ t: "frame", x: w.x, y: w.y, th: w.th, simMs: s.simUs / 1000 }); } } });
await s.run("print('hello')");
postMessage({ t: "ready", firstPrintMs: performance.now() - t0, coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, jspi: typeof WebAssembly.Suspending });
onmessage = async (e) => {
  const m = e.data;
  if (m.t === "run") { if (m.speed !== undefined) s.speed = m.speed; const a = performance.now(); const r = await s.run(m.code); postMessage({ t: "done", r, ms: performance.now() - a, simMs: s.simUs / 1000, yields: s.yields, x: s.world.x }); }
  else if (m.t === "stop") s.stop(); else if (m.t === "pause") s.pause(); else if (m.t === "unpause") s.unpause(); else if (m.t === "step") s.step();
};
