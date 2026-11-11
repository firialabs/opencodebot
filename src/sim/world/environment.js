// A room: its obstacles and its floor, in metres (x east, y north, z up).
//
// Obstacles are axis-aligned boxes, which is what the rooms' physics
// impostors are. A robot meets a box only if the box reaches down into the
// robot's height band, so a CodeBot drives under a locker that a CodeAIR hits.
import { Floor } from './floor.js'

export class Environment {
  // world: the parsed world.json; floorMap: the decoded floor image (or null).
  constructor(world, floorMap = null) {
    this.id = world.id
    this.obstacles = world.obstacles.map((o) => ({ name: o.name, min: o.min, max: o.max }))
    this.spawns = world.spawns ?? [{ name: 'center', x: 0, y: 0, heading: 0 }]
    this.bounds = world.floor
      ? { minX: world.floor.minX, maxX: world.floor.maxX, minY: world.floor.minY, maxY: world.floor.maxY }
      : { minX: -5, maxX: 5, minY: -5, maxY: 5 }
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

  // The boxes that reach into the band of heights [z0, z1].
  obstaclesIn(z0, z1) {
    return this.obstacles.filter((o) => o.min[2] < z1 && o.max[2] > z0)
  }

  // Push a circle (x, y, radius r) out of the given boxes. Returns the
  // corrected centre and whether it touched anything.
  static pushOut(x, y, r, boxes) {
    let hit = false
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (const b of boxes) {
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

  // Distance along a ray in the floor plane to the first box, or Infinity.
  static rayCast(ox, oy, dx, dy, boxes, maxDist) {
    let best = maxDist
    for (const b of boxes) {
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
