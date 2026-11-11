// The simulator's picture: a Three.js scene of the room and the devices in
// it, drawn from the snapshots the world sends. It owns no state the program
// can see; the world decides where everything is.
//
// Coordinates: the world's (x east, y north, z up) is Three's (x, z up -> y,
// north -> -z); a heading h is a rotation of h about Three's +y.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CodeBotFigure } from './codebot-figure.js'
import { CodeAIRFigure } from './codeair-figure.js'

const FIGURES = { codebot: CodeBotFigure, codeair: CodeAIRFigure }

export class SimView {
  constructor(host, { assetsBase }) {
    this.host = host
    this.assetsBase = assetsBase
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    this.figures = new Map()
    this.frames = [null, null]      // the two latest snapshots, with arrival times
    this.cameraMode = 'chase'

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }))
    r.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(r.domElement)
    r.domElement.className = 'sim-canvas'

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xdfe8ef)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5b4b, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(3, 8, 2)
    this.scene.add(sun)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200)
    this.camera.position.set(0.6, 0.5, 0.6)
    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.minDistance = 0.12
    this.controls.maxDistance = 30
    this.controls.addEventListener('start', () => { if (this.cameraMode === 'chase') this.cameraMode = 'orbit' })

    this._resize = new ResizeObserver(() => this.resize())
    this._resize.observe(host)
    this.resize()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  async loadRoom(id) {
    const gltf = await this.loader.loadAsync(`${this.assetsBase}env/${id}/room.glb`)
    this.room?.removeFromParent()
    this.room = gltf.scene
    // The rooms are modelled at 1 unit = 10 cm.
    this.room.scale.setScalar(0.1)
    this.room.traverse((o) => {
      if (o.isMesh && o.material?.map) o.material.map.anisotropy = 4
    })
    this.scene.add(this.room)
  }

  async addDevice(snap) {
    const Figure = FIGURES[snap.kind]
    const fig = new Figure()
    await fig.load(this.loader, this.assetsBase)
    this.scene.add(fig.root)
    this.figures.set(snap.id, fig)
    fig.update(snap)
    this._placeCamera(snap, true)
    return fig
  }

  // A snapshot from the world: { t, devices: [...] }.
  push(frame) {
    this.frames = [this.frames[1], { frame, at: performance.now() }]
  }

  setCamera(mode) {
    this.cameraMode = mode
    const s = this.frames[1]?.frame.devices[0]
    if (s) this._placeCamera(s, true)
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    cancelAnimationFrame(this._raf)
    this._resize.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // Draw the device where it is now: between the last two snapshots, by how
  // far the wall clock has gone from one to the next.
  _current() {
    const [a, b] = this.frames
    if (!b) return null
    if (!a || a.frame.devices.length !== b.frame.devices.length) return b.frame.devices
    const span = b.at - a.at
    const f = span > 0 ? Math.min(1, (performance.now() - b.at) / span) : 1
    return b.frame.devices.map((d, i) => lerpSnap(a.frame.devices[i], d, f))
  }

  _placeCamera(s, jump) {
    const target = new THREE.Vector3(s.x, (s.z ?? 0) + 0.04, -s.y)
    if (this.cameraMode === 'top') {
      this.camera.position.set(s.x, 2.2 + (s.z ?? 0), -s.y + 0.001)
      this.controls.target.copy(target)
    } else if (this.cameraMode === 'chase') {
      const back = new THREE.Vector3(-Math.cos(s.heading), 0, Math.sin(s.heading)).multiplyScalar(0.45)
      const want = target.clone().add(back).add(new THREE.Vector3(0, 0.28, 0))
      if (jump) this.camera.position.copy(want)
      else this.camera.position.lerp(want, 0.08)
      this.controls.target.lerp(target, jump ? 1 : 0.2)
    } else if (jump) {
      this.controls.target.copy(target)
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop)
    if (!this.host.isConnected || this.host.clientWidth === 0) return
    const devices = this._current()
    if (devices) {
      for (const s of devices) this.figures.get(s.id)?.update(s)
      if (this.cameraMode !== 'orbit') this._placeCamera(devices[0], false)
      else {
        // Orbit follows the robot without fighting the student's drag.
        const t = new THREE.Vector3(devices[0].x, (devices[0].z ?? 0) + 0.04, -devices[0].y)
        const d = t.clone().sub(this.controls.target)
        this.controls.target.add(d)
        this.camera.position.add(d)
      }
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}

function lerpSnap(a, b, f) {
  let dh = b.heading - a.heading
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  const L = (k) => (b[k] === undefined || a[k] === undefined ? b[k] : a[k] + (b[k] - a[k]) * f)
  return {
    ...b,
    x: L('x'), y: L('y'), z: L('z'), roll: L('roll'), pitch: L('pitch'), propAngle: L('propAngle'),
    heading: a.heading + dh * f,
    wheelAngle: b.wheelAngle && a.wheelAngle ? b.wheelAngle.map((w, i) => a.wheelAngle[i] + (w - a.wheelAngle[i]) * f) : b.wheelAngle,
  }
}
