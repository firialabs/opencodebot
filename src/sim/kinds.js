// Which boards the simulator offers, where each one lives, and which Python
// folders (under src/sim/python/) it runs. Kept apart from the models so the
// page can ask without loading them.
export const KINDS = {
  codebot: { env: 'gym', envName: 'gymnasium', view: '3d', python: ['common', 'codebot'] },
  codex: { env: 'empty', envName: 'hand', view: 'codex', python: ['common', 'radio', 'codex'] },
  codeair: { env: 'gym', envName: 'gymnasium', view: '3d', python: ['common', 'radio', 'codeair'] },
}
