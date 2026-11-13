// Which boards the simulator offers, where each one lives, and which Python
// folders (under src/sim/python/) it runs. Kept apart from the models so the
// page can ask without loading them.
import { t } from '../i18n/index.js'

export const KINDS = {
  codebot: { env: 'gym', view: '3d', python: ['common', 'codebot'] },
  codex: { env: 'empty', view: 'codex', python: ['common', 'radio', 'codex'] },
  // and the flight library, which only a build with CodeAIR flight carries
  // (sim/tools/flight-library.mjs): without it CodeAIR is not offered
  codeair: { env: 'gym', view: '3d', python: ['common', 'radio', 'codeair'], needsFlight: true },
}

// The rooms a 3D board can be in (built by sim/tools/build-env.mjs), in the
// picker's order. A room is fetched only when it is chosen.
export const ROOMS = {
  gym: t('room.gym'),
  classroom: t('room.classroom'),
  cafeteria: t('room.cafeteria'),
  auditorium: t('room.auditorium'),
}

// A room's music, where it has a track: room id -> { file, credit }, the file
// under sim-assets/ (its licence in sim/assets/LICENSE and
// THIRD_PARTY_NOTICES.md) and the string key of its credit, which the
// settings panel shows while it plays, looped, on the Music bus. No room has
// one yet: the haunted house rooms will bring theirs, e.g.
//   attic: { file: 'music/attic.mp3', credit: 'music.creditKidFears' }
export const MUSIC = {}
