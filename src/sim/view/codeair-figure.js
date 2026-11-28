// CodeAIR as drawn: the drone's model leaning as it accelerates, its
// propellers turning while the motors run, its NeoPixels, blue LEDs and
// green status LED lit from the snapshot, and a soft shadow on the floor below.
//
// The model (codeair.glb) is in metres, its front toward +z and its left
// toward +x (the board's silkscreen arrow), its underside about 4 mm above
// its origin. The figure's root sits at the world pose: under the drone's
// centre at the height of its underside, facing +x.
import * as THREE from 'three'
import { Led, boxIn, neoPixel, reflect, wear, yawIn } from './led.js'
import { Keys } from './keys.js'
import { Parts, loadParts } from './parts.js'

const UNDERSIDE = 0.004          // the model's lowest point above its origin

// codeair.py's pixel numbers (TOP_FRONT_RIGHT 0, BOTTOM_FRONT_RIGHT 1, ...)
// to the model's NeoPixels: Pixel1 front left, 2 front right, 3 rear left,
// 4 rear right; a `b` is the one under the board.
const PIXELS = ['Pixel2', 'Pixel2b', 'Pixel1', 'Pixel1b', 'Pixel3b', 'Pixel3', 'Pixel4', 'Pixel4b']
const BLUE = 0x2a6bff, GREEN = 0x22ff33, AMBER = 0xffa020

export class CodeAIRFigure {
  constructor() {
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()
    this.root.add(this.tilt)
    this.body = new THREE.Group()          // model frame
    this.body.rotation.y = Math.PI / 2     // model forward (+z) to the figure's forward (+x)
    this.body.position.y = -UNDERSIDE
    this.tilt.add(this.body)
    // the camera turns round the board's middle and may come within 3 cm of
    // it, near enough to look at its LEDs and buttons (view.js)
    this.aim = 0.012
    this.closest = 0.03
    this.props = []
    this.leds = []                         // BYTE 0 to 7, then STA
    this.pixels = []
  }

  /** Every light on the board (led.js), for its look. */
  get lights() {
    return [...this.leds, ...this.pixels].filter(Boolean)
  }

  // env: studio light for the metal to reflect (view.js)
  async load(loader, base, env) {
    const [gltf, parts] = await Promise.all([loader.loadAsync(`${base}models/codeair.glb`), loadParts(`${base}models/codeair.parts.json`)])
    this.body.add(gltf.scene)
    this.parts = new Parts(gltf.scene, parts)
    gltf.scene.traverse((o) => {
      if (/^Prop\d$/.test(o.name)) this.props.push(o)
      // The model comes without normals (sim/tools/build-models.mjs): shade it flat.
      if (o.isMesh && !o.geometry.attributes.normal) {
        for (const m of [o.material].flat()) m.flatShading = true
        o.geometry.computeVertexNormals()
      }
    })
    this.props.sort((a, b) => a.name.localeCompare(b.name))

    reflect(gltf.scene, env)
    // BTN-0, BTN-1 and reset: a click presses them (keys.js); each a 4 mm
    // switch, the whole part going down a quarter of a millimetre. A click
    // passes through the propellers, which stop wherever they stop: a blade
    // at rest over reset would otherwise hide it.
    const onProp = (o) => this.props.some((p) => p === o || p.getObjectById(o.id))
    this.keys = new Keys(gltf.scene, { through: onProp })
    for (const [n, name] of [[0, 'ButtonB0'], [1, 'ButtonB1'], ['reset', 'ButtonRST']]) {
      this.keys.add(n, [gltf.scene.getObjectByName(name)], { reach: 0.0025, travel: 0.00025 })
    }
    // Each LED seated on its part in the model: a lens over the part's top,
    // as wide as its window and turned as the part is on the board.
    const node = (name) => gltf.scene.getObjectByName(name)
    const seat = (name, color, lens, glow) => {
      const part = node(name)
      const box = boxIn(this.body, part)
      const at = box.getCenter(new THREE.Vector3())
      at.y = box.max.y + lens[1] / 2
      const led = new Led(this.body, at, lens, color, glow)
      led.mesh.rotation.y = yawIn(this.body, part)
      return led
    }
    for (let n = 0; n < 8; n++) this.leds.push(seat(`BYTE_${n}`, BLUE, [0.0012, 0.0003, 0.0007], 0.008))
    this.leds.push(seat('STA', GREEN, [0.0007, 0.0003, 0.0012], 0.008))
    // CHG lights while the battery charges on USB, and a simulated CodeAIR is
    // never on USB: it stays dark.
    seat('CHG', AMBER, [0.0007, 0.0003, 0.0012], 0.008)
    // the NeoPixels lit in the cup in each one's top (led.js), four on top
    // and four under the board, their cups facing down
    this.pixels = PIXELS.map((name) => neoPixel(this.body, node(name), name.endsWith('b') ? -1 : 1))
    wear(this.lights, 'codeair')

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
    this.shadow.userData.realism = 'shadows'
    this.root.add(this.shadow)
  }

  // A button's centre in the world; the button a ray meets, or -1 (view.js).
  keyCentre(n) { return this.keys?.keyCentre(n) }
  keyAt(raycaster) { return this.keys?.keyAt(raycaster) ?? -1 }
  // The part a ray meets, by the CAD's name, or null (parts.js).
  partAt(raycaster) { return this.parts?.at(raycaster) ?? null }

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
    this.leds.forEach((l, i) => l.set(s.leds[i < 8 ? 7 - i : 8] / 255))
    this.pixels.forEach((p, i) => p.rgb(...s.pixels[i]))
    this.keys?.show((n) => (n === 'reset' ? s.reset : s.buttons?.[n]))
  }
}
