/**
 * Blocks declare what their Python needs (an import, a one-time setup line)
 * while the generator walks the workspace. The code assembler then builds a
 * tidy, correctly ordered header once, instead of every block repeating it.
 */
let needs = new Set()

export function need(...keys) {
  for (const key of keys) needs.add(key)
}

export function resetNeeds() {
  needs = new Set()
}

export function hasNeed(key) {
  return needs.has(key)
}

export function allNeeds() {
  return needs
}
