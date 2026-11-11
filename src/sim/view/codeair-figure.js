// CodeAIR as drawn: the drone's model leaning as it accelerates, its
// propellers turning while the motors run, its NeoPixels, blue LEDs and
// status LED lit from the snapshot, and a soft shadow on the floor below.
//
// The model (codeair.glb) is in metres, its front toward +z and its left
// toward +x (the board's silkscreen arrow), its underside about 4 mm above
// its origin. The figure's root sits at the world pose: under the drone's
// centre at the height of its underside, facing +x.
import * as THREE from 'three'

const UNDERSIDE = 0.004          // the model's lowest point above its origin

// Where things are on the board, in model coordinates [x left, z forward],
// from the board's layout (TopPcb.jpg): the byte LEDs 0 to 7 in a column,
// the status LED by the battery pads, the NeoPixels on the four arms (top
// and bottom).
const BYTE = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [0.0100, 0.0066 - n * 0.00173])
const STATUS = [0.0164, -0.0102]
const ARMS = { FL: [0.0225, 0.0183], FR: [-0.0225, 0.0183], RL: [0.0225, -0.017], RR: [-0.0225, -0.017] }
// codeair.py's pixel numbers: TOP_FRONT_RIGHT 0, BOTTOM_FRONT_RIGHT 1, ...
const PIXELS = [['FR', 1], ['FR', 0], ['FL', 1], ['FL', 0], ['RL', 0], ['RL', 1], ['RR', 1], ['RR', 0]]
const TOP_Y = 0.0255, BOTTOM_Y = 0.019

export class CodeAIRFigure {
  constructor() {
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()
    this.root.add(this.tilt)
    this.body = new THREE.Group()          // model frame
    this.body.rotation.y = Math.PI / 2     // model forward (+z) to the figure's forward (+x)
    this.body.position.y = -UNDERSIDE
    this.tilt.add(this.body)
    this.props = []
    this.ledMats = []
    this.pixelMats = []
  }

  async load(loader, base) {
    const gltf = await loader.loadAsync(`${base}models/codeair.glb`)
    this.body.add(gltf.scene)
    gltf.scene.traverse((o) => {
      if (/^Prop\d$/.test(o.name)) this.props.push(o)
      // The model comes without normals (sim/tools/build-models.mjs): shade it flat.
      if (o.isMesh && !o.geometry.attributes.normal) {
        for (const m of [o.material].flat()) m.flatShading = true
        o.geometry.computeVertexNormals()
      }
    })
    this.props.sort((a, b) => a.name.localeCompare(b.name))

    const dot = (x, y, z, size, mats, glow) => {
      const m = new THREE.MeshBasicMaterial({ color: 0x111111 })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 0.0012, size), m)
      mesh.position.set(x, y, z)
      this.body.add(mesh)
      if (glow) {
        // a halo, so a lit pixel reads at a distance
        const g = new THREE.Mesh(new THREE.SphereGeometry(size * 1.6, 10, 6),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
        g.position.copy(mesh.position)
        this.body.add(g)
        m.userData.halo = g.material
      }
      mats.push(m)
    }
    BYTE.forEach(([x, z]) => dot(x, TOP_Y, z, 0.0013, this.ledMats))
    dot(STATUS[0], TOP_Y, STATUS[1], 0.0013, this.ledMats)
    PIXELS.forEach(([arm, top]) => dot(ARMS[arm][0], top ? TOP_Y + 0.0005 : BOTTOM_Y - 0.0005, ARMS[arm][1], 0.0035, this.pixelMats, true))

    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.4)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.root.add(this.shadow)
  }

  update(s) {
    this.root.position.set(s.x, s.z, -s.y)
    this.root.rotation.y = s.heading
    this.tilt.rotation.set(s.roll, 0, -s.pitch)
    // the shadow stays on what is below, softer and wider the higher it flies
    const above = s.above ?? s.z
    this.shadow.position.y = 0.0015 - above
    const k = 1 + above * 1.5
    this.shadow.scale.set(k, k, 1)
    this.shadow.material.opacity = 1 / k
    // turning, slowed so it does not strobe; neighbours turn opposite ways
    this.props.forEach((p, i) => { p.rotation.y = (i === 0 || i === 3 ? 1 : -1) * s.propAngle * 0.15 })

    // LEDs n is the driver's output 7 - n; the status LED its output 8
    this.ledMats.forEach((m, i) => {
      const v = s.leds[i < 8 ? 7 - i : 8] / 255
      m.color.setRGB(0.07 + 0.2 * v, 0.07 + 0.45 * v, 0.07 + 0.93 * v)
    })
    this.pixelMats.forEach((m, i) => {
      const [r, g, b] = s.pixels[i]
      const lift = (v) => (v > 0 ? 0.25 + 0.75 * (v / 255) ** 0.5 : 0.07)
      m.color.setRGB(lift(r), lift(g), lift(b))
      m.userData.halo.color.setRGB(r / 255, g / 255, b / 255)
    })
  }
}
