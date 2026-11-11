// Repacks the device models (sim/assets/) for the browser:
//   node sim/tools/build-models.mjs
// Writes public/sim-assets/models/: lights and cameras removed, meshes joined
// by material, meshopt instead of Draco (no decoder wasm to fetch), WebP
// textures. For a school Chromebook's GPU: plain-colour materials share a
// palette texture (one draw call where there were dozens), meshes are
// simplified where the model is finer than it is ever seen, and textures are
// at most 1024 px.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression } from '@gltf-transform/extensions'
import { dedup, flatten, join, prune, weld, textureCompress, meshopt, palette, simplify, getBounds } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
// Each model: its source, and the nodes kept apart (not joined) because the
// figure moves them.
// `simplify`: the share of triangles to keep (at most), within `error` of the
// model's size (0.1% unless given: a millimetre on the 10 cm CodeAIR is 1%).
// `flat`: drop the normals first (CAD's per-face normals split every face
// from its neighbours, which no simplifier can collapse); the figure shades
// it flat. `minPart`: parts smaller than this share of the model's size go
// (a board's resistors and capacitors, which no camera here comes near).
const MODELS = {
  'codebot-body.glb': { source: 'BotBody.glb', simplify: 0.5 },
  'codebot-wheel.glb': { source: 'WheelAssy.glb' },
  'codeair.glb': { source: 'CodeAIR.glb', keep: /^Prop\d$/, simplify: 0.2, error: 0.005, flat: true, minPart: 0.008 },
}
const TEXTURE_MAX = 1024

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
})
const out = path.join(ROOT, 'public/sim-assets/models')
await fs.mkdir(out, { recursive: true })
await MeshoptSimplifier.ready
const dropNormals = (doc) => {
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null)
}
for (const [name, { source, keep, simplify: ratio, error = 0.001, flat, minPart }] of Object.entries(MODELS)) {
  const doc = await io.read(path.join(ROOT, 'sim/assets', source))
  for (const n of doc.getRoot().listNodes()) if (n.getCamera() || n.getExtension('KHR_lights_punctual')) n.dispose()
  doc.getRoot().listExtensionsUsed().filter((e) => e instanceof KHRDracoMeshCompression).forEach((e) => e.dispose())
  if (minPart) {
    const size = (b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
    const whole = size(getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]))
    let dropped = 0
    for (const n of doc.getRoot().listNodes()) {
      if (n.getMesh() && !n.listChildren().length && !keep?.test(n.getName()) && size(getBounds(n)) < minPart * whole) { n.dispose(); dropped++ }
    }
    console.log(name, 'dropped', dropped, 'small parts')
  }
  // join() leaves named nodes alone: name only the ones kept apart
  for (const n of doc.getRoot().listNodes()) {
    if (keep?.test(n.getName())) continue
    n.setName('')
    n.getMesh()?.setName('')
  }
  await doc.transform(
    dedup(), flatten(), palette({ min: 2 }), join({ keepNamed: true }),
    ...(flat ? [dropNormals] : []),
    weld(),
    ...(ratio ? [simplify({ simplifier: MeshoptSimplifier, ratio, error })] : []),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [TEXTURE_MAX, TEXTURE_MAX] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
  await io.write(path.join(out, name), doc)
  console.log(name, (await fs.stat(path.join(out, name))).size)
}
