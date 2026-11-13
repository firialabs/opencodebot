// Line courses: black tape on a white mat, laid on the floor of any room, as
// a class lays them with electrical tape on poster board. Metres, x east,
// y north, centred on the room's origin.
//
// A course's spawn puts the CodeBot on the line, heading along it, with its
// line sensors over the tape.
import { t } from '../../i18n/index.js'
import { CB3 } from './codebot.js'

export const TAPE_WIDTH = 0.019        // 3/4 inch electrical tape
export const TAPE_REFLECTANCE = 0.04
export const MAT_REFLECTANCE = 0.85
const SENSORS_AHEAD = CB3.lineSensors[2][0]   // where the CB3's line sensors see, ahead of its axle

function arc(cx, cy, r, a0, a1, n = 48) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

// Join pieces of a path, dropping a point that repeats the previous one.
function path(...pieces) {
  const out = []
  for (const p of pieces) {
    for (const pt of p) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1e-9) out.push(pt)
    }
  }
  return out
}

// The point `s` metres along a polyline.
function along(points, s) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    if (s <= len) return [ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len]
    s -= len
  }
  return points[points.length - 1]
}

// On the line `s` metres along it, facing the point its sensors should be on.
function spawnAlong(points, s) {
  const [x, y] = along(points, s)
  const [fx, fy] = along(points, s + SENSORS_AHEAD)
  return { x, y, heading: Math.atan2(fy - y, fx - x) }
}

// An oval: two 1.2 m straights joined by half circles of 0.5 m, run
// anticlockwise from the bottom straight. `gap` leaves a gap that long in
// the middle of the top straight.
function oval(gap = 0) {
  const L = 0.6, R = 0.5
  if (!gap) {
    const pts = path([[-L, -R], [L, -R]], arc(L, 0, R, -Math.PI / 2, Math.PI / 2), [[-L, R]], arc(-L, 0, R, Math.PI / 2, 1.5 * Math.PI))
    return { tapes: [pts], spawn: spawnAlong(pts, 0.3) }
  }
  const g = gap / 2
  const a = path([[-g, R], [-L, R]], arc(-L, 0, R, Math.PI / 2, 1.5 * Math.PI), [[L, -R]], arc(L, 0, R, -Math.PI / 2, Math.PI / 2), [[g, R]])
  return { tapes: [a], spawn: spawnAlong(a, L - g + Math.PI * R + 0.3) }
}

// A figure eight: a lemniscate 2.2 m across, its lines crossing square in
// the middle.
function figureEight() {
  const a = 1.1, n = 240, pts = []
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n
    const d = 1 + Math.sin(t) ** 2
    pts.push([(a * Math.cos(t)) / d, (a * Math.sin(t) * Math.cos(t)) / d])
  }
  // Just past the crossing, where the line runs nearly straight.
  const quarter = pts.slice(0, n / 4 + 1)
  let s = 0
  for (let i = 0; i + 1 < quarter.length; i++) s += Math.hypot(quarter[i + 1][0] - quarter[i][0], quarter[i + 1][1] - quarter[i][1])
  return { tapes: [pts], spawn: spawnAlong(pts, s + 0.05) }
}

// A T: a straight run north into a crossbar, where the robot must choose.
function tee() {
  const stem = [[0, -0.9], [0, 0.5]]
  return { tapes: [stem, [[-0.5, 0.5], [0.5, 0.5]]], spawn: spawnAlong(stem, 0.1) }
}

export const COURSES = {
  oval: { name: t('course.oval'), mat: [-1.35, -0.8, 1.35, 0.8], ...oval() },
  eight: { name: t('course.eight'), mat: [-1.35, -0.65, 1.35, 0.65], ...figureEight() },
  gap: { name: t('course.gap'), mat: [-1.35, -0.8, 1.35, 0.8], ...oval(0.12) },
  tee: { name: t('course.tee'), mat: [-0.8, -1.1, 0.8, 0.8], ...tee() },
}

// A course where a room lays it (its `courseAt`: clear floor, which may be
// a stage): the mat and tapes moved there, and its height.
function placed(c, env) {
  const { x = 0, y = 0, z = 0 } = env?.courseAt ?? {}
  const [x0, y0, x1, y1] = c.mat
  return {
    mat: [x0 + x, y0 + y, x1 + x, y1 + y],
    tapes: c.tapes.map((pts) => pts.map(([px, py]) => [px + x, py + y])),
    spawn: { ...c.spawn, x: c.spawn.x + x, y: c.spawn.y + y, z },
    z,
  }
}

// Lay a course on a room's floor (none: take it up). Returns where a
// CodeBot starts on it, or null.
export function layCourse(env, id) {
  env.floor.clear()
  const c = COURSES[id]
  if (!c) return null
  const p = placed(c, env)
  env.floor.addMat(...p.mat, MAT_REFLECTANCE)
  for (const pts of p.tapes) env.floor.addTape(pts, TAPE_WIDTH, TAPE_REFLECTANCE)
  return { name: c.name, ...p.spawn }
}

// What the view draws: the mat and the tape lines, where the room lays them.
export function courseShape(id, env) {
  const c = COURSES[id]
  if (!c) return null
  const { mat, tapes, z } = placed(c, env)
  return { mat, tapes, z, width: TAPE_WIDTH }
}
