// Builds one simulator environment from its source GLB (sim/assets/).
//
//   node sim/tools/build-env.mjs gym
//
// Writes public/sim-assets/env/<id>/:
//   room.glb    the room to render: impostor boxes removed, meshes joined by
//               material, meshopt-compressed, textures as WebP
//   world.json  what the simulation needs, and nothing it would have to render:
//               obstacles as boxes, the floor's extent and spawn points
//   floor.png   the floor's reflectance seen from above (8-bit grey), which the
//               line sensors sample
//
// Units: the source rooms are modelled at 1 unit = 10 cm. The simulation works
// in metres, on the floor plane: x = glTF x, y = -glTF z, heading counter-
// clockwise from +x.
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, flatten, join, prune, weld, textureCompress, meshopt } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

// One entry per environment. `floor` names the floor node; `impostor` matches
// the invisible boxes that stand for walls and furniture in physics.
// `floor` lists the floor's layers, bottom first; each is drawn over the last.
const ENVIRONMENTS = {
  gym: {
    source: 'Gymnasium.glb',
    unit: 0.1,
    floor: ['Gym_Floor', 'Plane.002'],   // bottom to top: the wood, then the court mat
    impostor: /^ImpostorBox/,
    drop: [],
    floorResolution: 0.01,           // metres per floor.png pixel
    spawns: [{ name: 'center', x: 0, y: 0, heading: Math.PI / 2 }],
  },
}

const id = process.argv[2]
const env = ENVIRONMENTS[id]
if (!env) {
  console.error(`usage: build-env.mjs <${Object.keys(ENVIRONMENTS).join('|')}>`)
  process.exit(1)
}
const out = path.join(ROOT, 'public/sim-assets/env', id)
await fs.mkdir(out, { recursive: true })

await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
const doc = await io.read(path.join(ROOT, 'sim/assets', env.source))
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
const nodes = []
scene.traverse((n) => nodes.push(n))
const u = env.unit

// Obstacles: each impostor box, as an axis-aligned box in metres. The rooms'
// boxes are all axis-aligned; a rotated one would need an oriented box here.
const obstacles = []
for (const n of nodes) {
  if (!env.impostor.test(n.getName())) continue
  const b = getBounds(n)
  obstacles.push({
    name: n.getName(),
    min: [r4(b.min[0] * u), r4(-b.max[2] * u), r4(b.min[1] * u)],
    max: [r4(b.max[0] * u), r4(-b.min[2] * u), r4(b.max[1] * u)],
  })
}

// Floor reflectance: rasterise the floor's triangles from above, sampling its
// base-colour texture through the UVs, as luminance.
const floorNodes = env.floor.map((name) => nodes.find((n) => n.getName() === name))
const fb = getBounds(floorNodes[0])
const floor = {
  minX: fb.min[0] * u, maxX: fb.max[0] * u,
  minY: -fb.max[2] * u, maxY: -fb.min[2] * u,
  resolution: env.floorResolution,
}
floor.width = Math.round((floor.maxX - floor.minX) / floor.resolution)
floor.height = Math.round((floor.maxY - floor.minY) / floor.resolution)
const reflect = Buffer.alloc(floor.width * floor.height)
for (const n of floorNodes) await rasteriseFloor(n, floor, reflect)
await sharp(reflect, { raw: { width: floor.width, height: floor.height, channels: 1 } })
  .png({ compressionLevel: 9 }).toFile(path.join(out, 'floor.png'))

const world = {
  id,
  units: 'metres; x east, y north, z up; heading counter-clockwise from +x',
  floor: { ...roundAll(floor), image: 'floor.png', rows: 'north to south' },
  obstacles,
  spawns: env.spawns,
}
await fs.writeFile(path.join(out, 'world.json'), JSON.stringify(world, null, 1))

// The render model: drop the impostors and placeholders, join by material.
for (const n of nodes) {
  const name = n.getName()
  if (env.impostor.test(name) || env.drop.some((re) => re.test(name))) n.dispose()
}
await doc.transform(
  dedup(), flatten(), join({ keepNamed: false }), weld(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true)
await io.write(path.join(out, 'room.glb'), doc)

const sizes = await Promise.all(['room.glb', 'floor.png', 'world.json'].map(async (f) => `${f} ${(await fs.stat(path.join(out, f))).size}`))
console.log(`${id}: ${obstacles.length} obstacles, floor ${floor.width}x${floor.height}; ${sizes.join(', ')}`)

async function rasteriseFloor(node, f, outBuf) {
  const prim = node.getMesh().listPrimitives()[0]
  const mat = prim.getMaterial()
  const tex = mat.getBaseColorTexture()
  const factor = mat.getBaseColorFactor()
  // A material with no texture is a 1x1 texture of its colour factor.
  const img = tex
    ? await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    : { data: factor.slice(0, 3).map((c) => Math.round(255 * linToSrgb(c))), info: { width: 1, height: 1 } }
  const { width: tw, height: th } = img.info
  const pos = prim.getAttribute('POSITION')
  const uv = prim.getAttribute('TEXCOORD_0')
  const idx = prim.getIndices()
  const m = node.getWorldMatrix()
  const P = [], T = []
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, [])
    const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    // pixel coordinates: column from minX, row from maxY (north) down
    P.push([(wx * u - f.minX) / f.resolution, (f.maxY - -wz * u) / f.resolution])
    T.push(uv ? uv.getElement(i, []) : [0, 0])
  }
  const count = idx ? idx.getCount() : pos.getCount()
  for (let t = 0; t < count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k))
    const [pa, pb, pc] = [P[a], P[b], P[c]]
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])
    if (Math.abs(area) < 1e-9) continue
    const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])))
    const x1 = Math.min(f.width - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])))
    const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])))
    const y1 = Math.min(f.height - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const w0 = ((pb[0] - px) * (pc[1] - py) - (pc[0] - px) * (pb[1] - py)) / area
        const w1 = ((pc[0] - px) * (pa[1] - py) - (pa[0] - px) * (pc[1] - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const s = w0 * T[a][0] + w1 * T[b][0] + w2 * T[c][0]
        const v = w0 * T[a][1] + w1 * T[b][1] + w2 * T[c][1]
        const tx = Math.min(tw - 1, Math.max(0, Math.floor((s - Math.floor(s)) * tw)))
        const ty = Math.min(th - 1, Math.max(0, Math.floor((v - Math.floor(v)) * th)))
        const o = (ty * tw + tx) * 3
        // Rec. 709 luminance of the sRGB texel, linearised, back to 8 bits
        const lin = 0.2126 * srgb(img.data[o]) + 0.7152 * srgb(img.data[o + 1]) + 0.0722 * srgb(img.data[o + 2])
        outBuf[y * f.width + x] = Math.round(255 * lin)
      }
    }
  }
}

function linToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

function srgb(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
function r4(v) { return Math.round(v * 1e4) / 1e4 }
function roundAll(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])) }
