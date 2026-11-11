// Which boards the simulator offers, and where each one lives. Kept apart
// from the models so the page can ask without loading them.
export const KINDS = {
  codebot: { env: 'gym', envName: 'gymnasium', view: '3d' },
  codex: { env: 'empty', envName: 'hand', view: 'codex' },
}
