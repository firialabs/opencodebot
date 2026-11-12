// Builds one simulator environment from its source GLB (sim/assets/).
//
//   node sim/tools/build-env.mjs gym
//
// Writes public/sim-assets/env/<id>/:
//   room.glb    the room to render: impostor boxes removed, meshes joined by
//               material, meshopt-compressed, textures as WebP
//   world.json  what the simulation needs, and nothing it would have to render:
//               obstacles as boxes, the floor's extent and spawn points
//   floor.webp  the floor's reflectance seen from above (8-bit grey, lossless), which the
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

// One entry per environment, all in metres except where it says source units
// (the picker's list and names are src/sim/kinds.js ROOMS).
//   floor     the nodes whose upward faces make the floor map, bottom first;
//              where two overlap, the higher (or, level, the later) wins
//   floorBelow source units: faces higher than this are not floor (ceilings,
//              and the lights some floor meshes carry)
//   impostor   the invisible boxes and upright cylinders that stand for walls
//              and furniture in physics (CodeSpace's impostors); notImpostor,
//              those left out (and out of the picture, as all impostors are)
//   drop       nodes left out of the render model
//   spawns     where a device starts, x, y, z (z: a raised floor, such as a stage)
//   courseAt   where a line course is laid: the room's clear floor
const ENVIRONMENTS = {
  gym: {
    source: 'Gymnasium.glb',
    unit: 0.1,
    floor: ['Gym_Floor', 'Plane.002'],   // bottom to top: the wood, then the court mat
    floorBelow: 1,
    impostor: /^ImpostorBox/,
    drop: [],
    floorResolution: 0.01,           // metres per floor.webp pixel
    spawns: [{ name: 'center', x: 0, y: 0, heading: Math.PI / 2 }],
    courseAt: { x: 0, y: 0, z: 0 },
  },
  // CodeSpace's spawns are Babylon coordinates, whose z is the glTF z and x
  // its mirror: (0, -25) is y = 2.5 here.
  classroom: {
    source: 'Classroom.glb',
    unit: 0.1,
    floor: ['Plane'],
    floorBelow: 1,
    impostor: /^Impostor(Box|Cylinder)/,
    drop: [/^SignBoard/],            // CodeSpace's line arena, shown only for its lessons
    floorResolution: 0.01,
    // between the front of the room and the first row of desks, facing the board
    spawns: [{ name: 'front', x: 0, y: 2.5, heading: Math.PI / 2 }],
    courseAt: { x: 0, y: 3.0, z: 0 },
  },
  cafeteria: {
    source: 'Cafeteria.glb',
    unit: 0.1,
    floor: ['Floor', 'Floor.003', 'Floor.001'],
    floorBelow: 1,
    impostor: /^Impostor(Box|Cylinder)/,
    drop: [],
    floorResolution: 0.02,           // a speckled floor: at 1 cm its map is 1 MB
    // in front of the serving counter, facing it
    spawns: [{ name: 'counter', x: 0, y: 2.5, heading: Math.PI / 2 }],
    courseAt: { x: 0, y: 2.5, z: 0 },
  },
  auditorium: {
    source: 'Auditorium.glb',
    unit: 0.1,
    floor: ['Auditorium_Floor.002', 'Auditorium_Stage.007'],
    floorBelow: 10,                  // the stage is 0.97 m up
    impostor: /^Impostor(Box|Cylinder)/,
    // a rail 2 cm wide from the stage's edge to the back of the hall, at the
    // stage's height, that no picture shows: a robot would drive out on it
    // over the seats
    notImpostor: [/^ImpostorBox\.028$/],
    drop: [],
    floorResolution: 0.01,
    // on the stage, facing the audience, a metre from its edge
    spawns: [{ name: 'stage', x: 0, y: 0.5, z: 0.97, heading: -Math.PI / 2 }],
    courseAt: { x: 0, y: 1.0, z: 0.97 },
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

// Obstacles: each impostor, as an axis-aligned box in metres, and an upright
// cylinder also as its centre and radius (its box still says which heights
// it spans). The rooms' boxes are all axis-aligned and their cylinders all
// upright; a rotated one would need more here, so the build refuses it.
const obstacles = []
for (const n of nodes) {
  if (!env.impostor.test(n.getName()) || env.notImpostor?.some((re) => re.test(n.getName()))) continue
  const b = getBounds(n)
  const o = {
    name: n.getName(),
    min: [r4(b.min[0] * u), r4(-b.max[2] * u), r4(b.min[1] * u)],
    max: [r4(b.max[0] * u), r4(-b.min[2] * u), r4(b.max[1] * u)],
  }
  if (/Cylinder/.test(o.name)) {
    const dx = o.max[0] - o.min[0], dy = o.max[1] - o.min[1]
    if (Math.abs(dx - dy) > 0.1 * Math.max(dx, dy)) throw new Error(`${o.name} is not an upright cylinder`)
    o.c = [r4((o.min[0] + o.max[0]) / 2), r4((o.min[1] + o.max[1]) / 2)]
    o.r = r4((dx + dy) / 4)
  }
  obstacles.push(o)
}

// Floor reflectance: rasterise the floor's upward faces from above, sampling
// their base-colour texture through the UVs, as luminance; the highest face
// at each point wins.
const floorNodes = env.floor.map((name) => {
  const n = nodes.find((m) => m.getName() === name)
  if (!n) throw new Error(`${id}: no floor node ${name}`)
  return n
})
const fb = floorNodes.map((n) => getBounds(n)).reduce((a, b) => ({
  min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])),
}))
const floor = {
  minX: fb.min[0] * u, maxX: fb.max[0] * u,
  minY: -fb.max[2] * u, maxY: -fb.min[2] * u,
  resolution: env.floorResolution,
}
floor.width = Math.round((floor.maxX - floor.minX) / floor.resolution)
floor.height = Math.round((floor.maxY - floor.minY) / floor.resolution)
const reflect = Buffer.alloc(floor.width * floor.height)
const depth = new Float32Array(floor.width * floor.height).fill(-Infinity)
for (const n of floorNodes) await rasteriseFloor(n, floor, reflect, depth, env.floorBelow)
await sharp(reflect, { raw: { width: floor.width, height: floor.height, channels: 1 } })
  .toColourspace('b-w').webp({ lossless: true, effort: 6 }).toFile(path.join(out, 'floor.webp'))

const world = {
  id,
  units: 'metres; x east, y north, z up; heading counter-clockwise from +x',
  floor: { ...roundAll(floor), image: 'floor.webp', rows: 'north to south' },
  obstacles,
  spawns: env.spawns,
  courseAt: env.courseAt,
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

const sizes = await Promise.all(['room.glb', 'floor.webp', 'world.json'].map(async (f) => `${f} ${(await fs.stat(path.join(out, f))).size}`))
console.log(`${id}: ${obstacles.length} obstacles, floor ${floor.width}x${floor.height}; ${sizes.join(', ')}`)

async function rasteriseFloor(node, f, outBuf, depth, below) {
  const prim = node.getMesh().listPrimitives()[0]
  const mat = prim.getMaterial()
  const tex = mat.getBaseColorTexture()
  const factor = mat.getBaseColorFactor()
  // A material with no texture is a 1x1 texture of its colour factor, taken as
  // it stands (botsim reads Babylon's albedoColor, the glTF factor, unconverted).
  const img = tex
    ? await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    : { data: factor.slice(0, 3).map((c) => Math.round(255 * c)), info: { width: 1, height: 1 } }
  const { width: tw, height: th } = img.info
  const pos = prim.getAttribute('POSITION')
  const uv = prim.getAttribute('TEXCOORD_0')
  const idx = prim.getIndices()
  const m = node.getWorldMatrix()
  const P = [], T = [], H = []
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, [])
    const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
    const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    // pixel coordinates: column from minX, row from maxY (north) down
    P.push([(wx * u - f.minX) / f.resolution, (f.maxY - -wz * u) / f.resolution])
    T.push(uv ? uv.getElement(i, []) : [0, 0])
    H.push(wy)
  }
  const count = idx ? idx.getCount() : pos.getCount()
  for (let t = 0; t < count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k))
    const [pa, pb, pc] = [P[a], P[b], P[c]]
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])
    if (Math.abs(area) < 1e-9) continue
    // Only faces that look up (on the map, rows run north to south, so an
    // upward face winds clockwise: negative area) and are low enough to be floor.
    if (area > 0 || Math.max(H[a], H[b], H[c]) > below) continue
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
        const h = w0 * H[a] + w1 * H[b] + w2 * H[c]
        if (h < depth[y * f.width + x] - 1e-3) continue
        depth[y * f.width + x] = h
        const s =w0 * T[a][0] + w1 * T[b][0] + w2 * T[c][0]
        const v = w0 * T[a][1] + w1 * T[b][1] + w2 * T[c][1]
        const tx = Math.min(tw - 1, Math.max(0, Math.floor((s - Math.floor(s)) * tw)))
        const ty = Math.min(th - 1, Math.max(0, Math.floor((v - Math.floor(v)) * th)))
        const o = (ty * tw + tx) * 3
        // The texel's three channels averaged, as stored (sRGB): what botsim's
        // line sensors take for reflectance, and so what CodeSpace's lessons expect
        outBuf[y * f.width + x] = Math.round((img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3)
      }
    }
  }
}

function r4(v) { return Math.round(v * 1e4) / 1e4 }
function roundAll(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])) }
