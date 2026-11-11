// Repacks the device models (sim/assets/) for the browser:
//   node sim/tools/build-models.mjs
// Writes public/sim-assets/models/: lights and cameras removed, meshes joined
// by material, meshopt instead of Draco (no decoder wasm to fetch), WebP
// textures.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression } from '@gltf-transform/extensions'
import { dedup, flatten, join, prune, weld, textureCompress, meshopt } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
// Each model: its source, and the nodes kept apart (not joined) because the
// figure moves them.
const MODELS = {
  'codebot-body.glb': { source: 'BotBody.glb' },
  'codebot-wheel.glb': { source: 'WheelAssy.glb' },
  'codeair.glb': { source: 'CodeAIR.glb', keep: /^Prop\d$/ },
}

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
})
const out = path.join(ROOT, 'public/sim-assets/models')
await fs.mkdir(out, { recursive: true })
for (const [name, { source, keep }] of Object.entries(MODELS)) {
  const doc = await io.read(path.join(ROOT, 'sim/assets', source))
  for (const n of doc.getRoot().listNodes()) if (n.getCamera() || n.getExtension('KHR_lights_punctual')) n.dispose()
  doc.getRoot().listExtensionsUsed().filter((e) => e instanceof KHRDracoMeshCompression).forEach((e) => e.dispose())
  // join() leaves named nodes alone: name only the ones kept apart
  for (const n of doc.getRoot().listNodes()) {
    if (keep?.test(n.getName())) continue
    n.setName('')
    n.getMesh()?.setName('')
  }
  await doc.transform(
    dedup(), flatten(), join({ keepNamed: true }), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
  await io.write(path.join(out, name), doc)
  console.log(name, (await fs.stat(path.join(out, name))).size)
}
