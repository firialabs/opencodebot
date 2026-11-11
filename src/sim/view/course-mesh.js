// A line course as drawn: the white mat and its black tape, flat on the
// floor, from the shape world/courses.js gives. World (x east, y north) is
// Three's (x, -z), as in view.js.
import * as THREE from 'three'

const MAT_Y = 0.001, TAPE_Y = 0.002

export function courseMesh({ mat, tapes, width }) {
  const group = new THREE.Group()
  group.name = 'course'

  const [x0, y0, x1, y1] = mat
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, y1 - y0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
  )
  sheet.rotation.x = -Math.PI / 2
  sheet.position.set((x0 + x1) / 2, MAT_Y, -(y0 + y1) / 2)
  group.add(sheet)

  const tape = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
  for (const pts of tapes) group.add(new THREE.Mesh(ribbon(pts, width / 2), tape))
  return group
}

// A flat strip of half-width h along a polyline, mitred at each joint.
function ribbon(pts, h) {
  const pos = []
  const index = []
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[Math.max(0, i - 1)]
    const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)]
    let dx = nx - px, dy = ny - py
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    const [x, y] = pts[i]
    // left and right of the direction of travel
    pos.push(x - dy * h, TAPE_Y, -(y + dx * h), x + dy * h, TAPE_Y, -(y - dx * h))
    if (i > 0) {
      const a = 2 * (i - 1)
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}
