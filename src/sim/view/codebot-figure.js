// CodeBot as drawn: the CB3 body and wheels, its LEDs lit from the snapshot,
// and a soft shadow under it.
//
// The body model is in 10 cm units, front toward +z, left toward +x, its motor
// shaft (the axle) 56 mm behind its origin and 12.5 mm below it. The figure's
// root sits at the world pose: the axle's midpoint on the floor, facing +x.
import * as THREE from 'three'

const U = 0.1                 // model units to metres
const AXLE_Z = -0.56          // model units
const AXLE_Y = -0.125
const WHEEL_R = 0.0325
const TRACK = 0.111
const PITCH = 0.3             // rad, front down to the skid

// LED positions in model units (x left, z forward), from the CB3 layout.
const USER = [23.9, 18.9, 13.8, 8.7, 3.6, -3.6, -8.7, -13.8].map((x, i) => [x / 100, 0.023, i])
const LS = [19.1, 9.7, 0, -9.7, -19.1].map((x) => [x / 100, 0.61])
const PROX = [[0.358, 0.596], [-0.358, 0.596]]
const PWR = [-0.333, -0.386]

export class CodeBotFigure {
  constructor() {
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()          // pitched about the axle
    this.root.add(this.tilt)
    this.tilt.position.y = WHEEL_R
    this.tilt.rotation.z = -PITCH
    this.ledMats = { user: [], ls: [], prox: [], pwr: [] }
  }

  async load(loader, base) {
    const [body, wheel] = await Promise.all([
      loader.loadAsync(`${base}models/codebot-body.glb`),
      loader.loadAsync(`${base}models/codebot-wheel.glb`),
    ])
    const b = body.scene
    b.scale.setScalar(U)
    // Model forward (+z) to the figure's forward (+x); axle to the origin.
    b.rotation.y = Math.PI / 2
    b.position.set(-AXLE_Z * U, -AXLE_Y * U, 0)
    this.tilt.add(b)

    this.wheels = [1, -1].map((side) => {
      const w = wheel.scene.clone()
      w.scale.setScalar(U)
      const holder = new THREE.Group()
      holder.position.set(0, WHEEL_R, (-side * TRACK) / 2)
      // The wheel model's axis is its x; turn it to the figure's z (across).
      w.rotation.y = Math.PI / 2 * side
      holder.add(w)
      this.root.add(holder)
      return holder
    })

    const led = (group, x, z, color) => {
      const m = new THREE.MeshBasicMaterial({ color: 0x222222 })
      m.userData.on = new THREE.Color(color)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.002, 0.003), m)
      // model (x left, z forward) to the body's frame after its rotation
      mesh.position.set(z * U - AXLE_Z * U, (-AXLE_Y + 0.012) * U, -x * U)
      this.tilt.add(mesh)
      this.ledMats[group].push(m)
    }
    USER.forEach(([x, z]) => led('user', x, z, 0x33ff44))
    LS.forEach(([x, z]) => led('ls', x, z, 0x2266ff))
    PROX.forEach(([x, z]) => led('prox', x, z, 0xff3322))
    led('pwr', PWR[0], PWR[1], 0x33ff44)

    // A soft shadow, cheaper than a shadow map.
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.45)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.16),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0.045, 0.0015, 0)
    this.root.add(shadow)
  }

  update(s) {
    this.root.position.set(s.x, 0, -s.y)
    this.root.rotation.y = s.heading
    if (this.wheels && s.wheelAngle) {
      this.wheels[0].rotation.z = -s.wheelAngle[0]
      this.wheels[1].rotation.z = -s.wheelAngle[1]
    }
    const bits = (mats, v) => mats.forEach((m, i) => m.color.copy((v >> i) & 1 ? m.userData.on : OFF))
    bits(this.ledMats.user, s.leds.user)
    bits(this.ledMats.ls, s.leds.ls)
    bits(this.ledMats.prox, s.leds.prox)
    bits(this.ledMats.pwr, s.leds.pwr ? 1 : 0)
  }
}

const OFF = new THREE.Color(0x222222)
