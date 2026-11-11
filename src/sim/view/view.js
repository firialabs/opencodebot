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
import { courseMesh } from './course-mesh.js'

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
    // Resolution adapts to the machine (_govern): a school Chromebook's GPU
    // gets fewer pixels rather than fewer frames.
    this.maxRatio = Math.min(globalThis.devicePixelRatio || 1, 1.5)
    this.ratio = this.maxRatio
    r.setPixelRatio(this.ratio)
    this._gov = { last: 0, sum: 0, n: 0, fastFor: 0 }
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
    this.controls.addEventListener('change', () => this._touch())
    this._changedAt = 0           // when the picture last had reason to change

    this._resize = new ResizeObserver(() => this.resize())
    this._resize.observe(host)
    this.resize()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  async loadRoom(id) {
    const ask = (this._roomAsked = id)
    const gltf = await this.loader.loadAsync(`${this.assetsBase}env/${id}/room.glb`)
    if (ask !== this._roomAsked) return        // another room was chosen meanwhile
    this.room?.removeFromParent()
    // the last room's buffers and textures, off the GPU
    this.room?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [o.material].flat()) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
        m.dispose()
      }
    })
    this.room = gltf.scene
    // The rooms are modelled at 1 unit = 10 cm.
    this.room.scale.setScalar(0.1)
    this.room.traverse((o) => {
      if (o.isMesh && o.material?.map) o.material.map.anisotropy = 4
    })
    this.scene.add(this.room)
    this.roomId = id
    this._touch()
  }

  // The line course on the floor (its shape from world/courses.js), or none.
  setCourse(shape) {
    this.course?.removeFromParent()
    this.course = shape ? courseMesh(shape) : null
    if (this.course) this.scene.add(this.course)
    this._touch()
  }

  async addDevice(snap) {
    const Figure = FIGURES[snap.kind]
    const fig = new Figure()
    await fig.load(this.loader, this.assetsBase)
    this.scene.add(fig.root)
    this.figures.set(snap.id, fig)
    this._touch()
    fig.update(snap)
    this._placeCamera(snap, true)
    return fig
  }

  // A snapshot from the world: { t, devices: [...] }.
  push(frame) {
    this.frames = [this.frames[1], { frame, at: performance.now() }]
    // Frames keep coming while nothing moves; only a change needs drawing.
    const key = JSON.stringify(frame.devices)
    if (key !== this._lastKey) { this._lastKey = key; this._touch() }
  }

  _touch() {
    this._changedAt = performance.now()
  }

  setCamera(mode) {
    this._touch()
    this.cameraMode = mode
    const s = this.frames[1]?.frame.devices[0]
    if (s) this._placeCamera(s, true)
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this._touch()
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
    const moved = this.controls.update()
    // Draw while things move, and a while after (the picture eases to rest:
    // interpolation, the chase camera); then rest, and leave the CPU to the
    // program.
    const now = performance.now()
    if (!moved && now - this._changedAt > SETTLE_MS) { this._gov.last = 0; return }
    this.renderer.render(this.scene, this.camera)
    this._govern(now)
  }

  // Every second of continuous drawing: below 24 frames a second, fewer
  // pixels (down to half); above 50 for three seconds, more again.
  _govern(now) {
    const g = this._gov
    if (g.last) { g.sum += now - g.last; g.n++ }
    g.last = now
    if (g.sum < 1000) return
    const fps = (1000 * g.n) / g.sum
    g.sum = 0; g.n = 0
    let ratio = this.ratio
    if (fps < 24 && ratio > MIN_RATIO) { ratio = Math.max(MIN_RATIO, ratio * 0.8); g.fastFor = 0 }
    else if (fps > 50 && ratio < this.maxRatio && ++g.fastFor >= 3) { ratio = Math.min(this.maxRatio, ratio * 1.15); g.fastFor = 0 }
    if (ratio !== this.ratio) {
      this.ratio = ratio
      this.renderer.setPixelRatio(ratio)
      this.resize()
    }
  }
}

const SETTLE_MS = 1500
const MIN_RATIO = 0.5

function lerpSnap(a, b, f) {
  let dh = b.heading - a.heading
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  const L = (k) => (b[k] === undefined || a[k] === undefined ? b[k] : a[k] + (b[k] - a[k]) * f)
  return {
    ...b,
    x: L('x'), y: L('y'), z: L('z'), above: L('above'), roll: L('roll'), pitch: L('pitch'), propAngle: L('propAngle'),
    heading: a.heading + dh * f,
    wheelAngle: b.wheelAngle && a.wheelAngle ? b.wheelAngle.map((w, i) => a.wheelAngle[i] + (w - a.wheelAngle[i]) * f) : b.wheelAngle,
  }
}
