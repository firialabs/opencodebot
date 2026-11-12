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
