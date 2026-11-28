// A board's buttons as drawn: parts of its model that a click presses
// (view.js finds them with keyAt) and that go down while held. One mechanism
// for every board: CodeX's six keys and reset, CodeBot's BTN-0 and BTN-1,
// CodeAIR's BTN-0, BTN-1 and reset.
//
// Each button is given in its model's frame, whose +y is up from the board.
import * as THREE from 'three'
import { boxIn } from './led.js'

export class Keys {
  // `model`: the board's model, so a button hidden behind its other parts
  // (CodeX's reset, under the board) is not pressed through them.
  // `through(part)`: true of a part a click passes through to a button,
  // as a finger would push past it (CodeAIR's propellers: one may come to
  // rest with a blade over reset).
  constructor(model = null, { through = () => false } = {}) {
    this.model = model
    this.through = through
    this.keys = new Map()      // number -> { meshes, rest }
    this.pick = []             // the invisible targets a click finds
  }

  // Button `n` (the program's number for it, or a name such as 'reset'):
  // `meshes`, the parts that go down when it is pressed (siblings in one
  // model frame); `reach`, the radius a click finds it within; `travel`, how
  // far it goes down; both in that frame's units.
  add(n, meshes, { reach, travel }) {
    meshes = meshes.filter(Boolean)
    if (!meshes.length) return
    const frame = meshes[0].parent
    const box = new THREE.Box3()
    for (const m of meshes) box.union(boxIn(frame, m))
    const centre = box.getCenter(new THREE.Vector3())
    const height = box.max.y - box.min.y
    const target = new THREE.Mesh(
      new THREE.CylinderGeometry(reach, reach, Math.max(height, reach) * 1.5, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    target.position.copy(centre)
    target.userData.key = n
    frame.add(target)
    this.pick.push(target)
    this.keys.set(n, { meshes, rest: meshes.map((m) => m.position.y), travel, centre, frame })
  }

  // The button a ray meets, or -1: one the model hides is not met.
  keyAt(raycaster) {
    const hit = raycaster.intersectObjects(this.pick, false)[0]
    if (!hit) return -1
    const n = hit.object.userData.key
    if (this.model) {
      const own = this.keys.get(n).meshes
      const isOwn = (o) => own.some((m) => m === o || m.getObjectById(o.id))
      const front = raycaster.intersectObject(this.model, true)
        .find((h) => h.object.userData.key === undefined && !isOwn(h.object) && !this.through(h.object))
      if (front && front.distance < hit.distance) return -1
    }
    return n
  }

  // Button n's centre in the world.
  keyCentre(n) {
    const k = this.keys.get(n)
    return k && k.frame.localToWorld(k.centre.clone())
  }

  // Each button down while `down(n)` says it is held.
  show(down) {
    for (const [n, k] of this.keys) {
      const d = down(n) ? k.travel : 0
      k.meshes.forEach((m, i) => { m.position.y = k.rest[i] - d })
    }
  }
}
