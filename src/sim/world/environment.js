// A room: its obstacles and its floor, in metres (x east, y north, z up).
//
// Obstacles are what the rooms' physics impostors are: axis-aligned boxes,
// and upright cylinders (table legs, pillars), which carry their centre `c`
// and radius `r` beside the box around them. A robot meets an obstacle only
// if it reaches into the robot's height band, so a CodeBot drives under a
// locker that a CodeAIR hits. The top of an obstacle is also a floor: a
// stage, a table top (supportAt).
import { Floor } from './floor.js'

export class Environment {
  // world: the parsed world.json; floorMap: the decoded floor image (or null).
  constructor(world, floorMap = null) {
    this.id = world.id
    this.obstacles = world.obstacles.map((o) => (o.r ? { name: o.name, min: o.min, max: o.max, c: o.c, r: o.r } : { name: o.name, min: o.min, max: o.max }))
    this.spawns = world.spawns ?? [{ name: 'center', x: 0, y: 0, heading: 0 }]
    this.courseAt = world.courseAt ?? { x: 0, y: 0, z: 0 }
    this.floor = new Floor(floorMap, world.floor?.plain ?? 0.5)
  }

  // An empty square room, for tests and as a fallback.
  static empty(size = 4) {
    const h = size / 2, t = 0.1, H = 1
    const wall = (name, min, max) => ({ name, min, max })
    return new Environment({
      id: 'empty',
      floor: { minX: -h, maxX: h, minY: -h, maxY: h, plain: 0.8 },
      obstacles: [
        wall('north', [-h - t, h, 0], [h + t, h + t, H]),
        wall('south', [-h - t, -h - t, 0], [h + t, -h, H]),
        wall('east', [h, -h, 0], [h + t, h, H]),
        wall('west', [-h - t, -h, 0], [-h, h, H]),
      ],
      spawns: [{ name: 'center', x: 0, y: 0, heading: Math.PI / 2 }],
    })
  }

  // The obstacles that reach into the band of heights [z0, z1].
  obstaclesIn(z0, z1) {
    return this.obstacles.filter((o) => o.min[2] < z1 && o.max[2] > z0)
  }

  // The height of the floor under (x, y) for something whose underside is
  // at z: the highest top at or below z + step (a step that low is climbed),
  // or the room's floor, 0.
  supportAt(x, y, z, step = 0) {
    let top = 0
    for (const o of this.obstacles) {
      const t = o.max[2]
      if (t > top && t <= z + step + 1e-6 && Environment.contains(o, x, y)) top = t
    }
    return top
  }

  // Whether an obstacle covers (x, y), seen from above.
  static contains(o, x, y) {
    if (o.r) {
      const dx = x - o.c[0], dy = y - o.c[1]
      return dx * dx + dy * dy <= o.r * o.r
    }
    return x >= o.min[0] && x <= o.max[0] && y >= o.min[1] && y <= o.max[1]
  }

  // The point of an obstacle's outline, seen from above, nearest (x, y); (x, y)
  // itself when it is inside a box.
  static nearest(o, x, y) {
    if (o.r) {
      const dx = x - o.c[0], dy = y - o.c[1]
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1e-12) return [o.c[0] + o.r, o.c[1]]
      return d <= o.r ? [x, y] : [o.c[0] + (dx / d) * o.r, o.c[1] + (dy / d) * o.r]
    }
    return [x < o.min[0] ? o.min[0] : x > o.max[0] ? o.max[0] : x, y < o.min[1] ? o.min[1] : y > o.max[1] ? o.max[1] : y]
  }

  // Push a circle (x, y, radius r) out of the given obstacles. Returns the
  // corrected centre and whether it touched anything.
  static pushOut(x, y, r, boxes) {
    let hit = false
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (const b of boxes) {
        if (b.r) {
          // circle against circle: out along the line between the centres
          let dx = x - b.c[0], dy = y - b.c[1]
          const R = r + b.r, d2 = dx * dx + dy * dy
          if (d2 >= R * R) continue
          hit = moved = true
          const d = Math.sqrt(d2)
          if (d < 1e-12) { dx = 1; dy = 0 } else { dx /= d; dy /= d }
          x = b.c[0] + dx * R
          y = b.c[1] + dy * R
          continue
        }
        const cx = x < b.min[0] ? b.min[0] : x > b.max[0] ? b.max[0] : x
        const cy = y < b.min[1] ? b.min[1] : y > b.max[1] ? b.max[1] : y
        let dx = x - cx, dy = y - cy
        const d2 = dx * dx + dy * dy
        if (d2 >= r * r) continue
        hit = moved = true
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2)
          x = cx + (dx / d) * r
          y = cy + (dy / d) * r
        } else {
          // Centre inside the box: leave by the nearest face.
          const exits = [
            [x - b.min[0] + r, -1, 0], [b.max[0] - x + r, 1, 0],
            [y - b.min[1] + r, 0, -1], [b.max[1] - y + r, 0, 1],
          ].sort((p, q) => p[0] - q[0])
          x += exits[0][1] * exits[0][0]
          y += exits[0][2] * exits[0][0]
        }
      }
      if (!moved) break
    }
    return { x, y, hit }
  }

  // Distance along a ray in the floor plane (unit direction) to the first
  // obstacle, or Infinity.
  static rayCast(ox, oy, dx, dy, boxes, maxDist) {
    let best = maxDist
    for (const b of boxes) {
      if (b.r) {
        const fx = ox - b.c[0], fy = oy - b.c[1]
        const along = fx * dx + fy * dy
        const c = fx * fx + fy * fy - b.r * b.r
        if (c <= 0) { best = 0; continue }          // starts inside it
        const disc = along * along - c
        if (along >= 0 || disc < 0) continue
        const t = -along - Math.sqrt(disc)
        if (t < best) best = t
        continue
      }
      let t0 = 0, t1 = best
      if (Math.abs(dx) < 1e-12) {
        if (ox < b.min[0] || ox > b.max[0]) continue
      } else {
        let ta = (b.min[0] - ox) / dx, tb = (b.max[0] - ox) / dx
        if (ta > tb) { const s = ta; ta = tb; tb = s }
        if (ta > t0) t0 = ta
        if (tb < t1) t1 = tb
        if (t0 > t1) continue
      }
      if (Math.abs(dy) < 1e-12) {
        if (oy < b.min[1] || oy > b.max[1]) continue
      } else {
        let ta = (b.min[1] - oy) / dy, tb = (b.max[1] - oy) / dy
        if (ta > tb) { const s = ta; ta = tb; tb = s }
        if (ta > t0) t0 = ta
        if (tb < t1) t1 = tb
        if (t0 > t1) continue
      }
      if (t0 < best) best = t0
    }
    return best < maxDist ? best : Infinity
  }
}
