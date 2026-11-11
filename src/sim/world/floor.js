// The floor as the line sensors see it: reflectance from 0 (black) to 1
// (white), from the room's floor map plus any tape laid on it.
//
// The map is the room's floor seen from above (built by
// sim/tools/build-env.mjs). Tape is vector: a line course is a polyline with a
// width, sampled exactly, so a 19 mm tape line is crisp however coarse the map.
export class Floor {
  // map: { minX, maxY, resolution, width, height, data: Uint8Array } with rows
  // from north (maxY) to south. Without a map the floor is uniform `plain`.
  constructor(map, plain = 0.5) {
    this.map = map
    this.plain = plain
    this.tapes = []
  }

  // Lay tape: points [[x, y], ...] in metres, width in metres, reflectance 0..1.
  addTape(points, width, reflectance = 0.04) {
    const segs = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]])
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const h = width / 2
    const tape = { points, width, reflectance, segs, h, box: [minX - h, minY - h, maxX + h, maxY + h] }
    this.tapes.push(tape)
    return tape
  }

  clearTape() {
    this.tapes.length = 0
  }

  // The map's reflectance at a point, bilinearly interpolated.
  base(x, y) {
    const m = this.map
    if (!m) return this.plain
    const fx = (x - m.minX) / m.resolution - 0.5
    const fy = (m.maxY - y) / m.resolution - 0.5
    if (fx < 0 || fy < 0 || fx >= m.width - 1 || fy >= m.height - 1) return this.plain
    const ix = Math.floor(fx), iy = Math.floor(fy)
    const tx = fx - ix, ty = fy - iy
    const o = iy * m.width + ix
    const d = m.data
    const top = d[o] + (d[o + 1] - d[o]) * tx
    const bot = d[o + m.width] + (d[o + m.width + 1] - d[o + m.width]) * tx
    return (top + (bot - top) * ty) / 255
  }

  // Mean reflectance over a sensor's spot of the given radius.
  reflectance(x, y, radius) {
    let r = this.base(x, y)
    for (const t of this.tapes) {
      if (x < t.box[0] - radius || x > t.box[2] + radius || y < t.box[1] - radius || y > t.box[3] + radius) continue
      let cover = 0
      for (const [a, b] of t.segs) {
        const c = bandCover(distToSegment(x, y, a, b), t.h, radius)
        if (c > cover) cover = c
      }
      r += (t.reflectance - r) * cover
    }
    return r
  }
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = ax + t * dx - px, ey = ay + t * dy - py
  return Math.sqrt(ex * ex + ey * ey)
}

// Fraction of a spot of radius r, centred d from a band's centre line, that
// lies within the band of half-width h (measured across the band).
function bandCover(d, h, r) {
  const lo = Math.max(d - r, -h), hi = Math.min(d + r, h)
  return hi > lo ? (hi - lo) / (2 * r) : 0
}
