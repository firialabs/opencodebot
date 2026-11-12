/**
 * A few helpers for writing block programs by hand, so each starter project
 * reads like the blocks it makes rather than like Blockly's save format.
 *
 *   program({ start: [b('codex_show', {}, { THING: 'Hi' })] })
 *
 * An input given a number becomes a number block, a string a text block, a
 * list a stack of statements, and a block itself plugs straight in.
 */

export const num = (value) => ({ shadow: { type: 'math_number', fields: { NUM: value } } })
export const str = (text) => ({ shadow: { type: 'text', fields: { TEXT: text } } })
export const color = (name) => ({ shadow: { type: 'ocb_color', fields: { COLOR: name } } })

/** A stack of statement blocks, each one's next the one after it. */
export function chain(blocks) {
  const copies = blocks.map((block) => ({ ...block }))
  for (let i = 0; i < copies.length - 1; i++) copies[i].next = { block: copies[i + 1] }
  return copies[0]
}

function input(value) {
  if (typeof value === 'number') return num(value)
  if (typeof value === 'string') return str(value)
  if (Array.isArray(value)) return { block: chain(value) }
  if (value?.type) return { block: value }
  return value
}

/** One block: its type, its fields, and what is plugged into its inputs. */
export function b(type, fields = {}, inputs = {}, extraState) {
  const block = { type }
  if (Object.keys(fields).length) block.fields = fields
  const plugged = Object.entries(inputs).filter(([, v]) => v !== undefined)
  if (plugged.length) block.inputs = Object.fromEntries(plugged.map(([k, v]) => [k, input(v)]))
  if (extraState) block.extraState = extraState
  return block
}

// Variables: a program names the ones it uses; blocks refer to them by id.
const varId = (key) => `ex_${key}`
export const getVar = (key) => b('variables_get', { VAR: { id: varId(key) } })
export const setVar = (key, value) => b('variables_set', { VAR: { id: varId(key) } }, { VALUE: value })
export const changeVar = (key, by) => b('math_change', { VAR: { id: varId(key) } }, { DELTA: by })
export const countWith = (key, from, to, by, body) =>
  b('controls_for', { VAR: { id: varId(key) } }, { FROM: from, TO: to, BY: by, DO: body })

// Loops and choices, Blockly's own blocks.
export const repeat = (times, body) => b('controls_repeat_ext', {}, { TIMES: times, DO: body })
export const whileTrue = (cond, body) => b('controls_whileUntil', { MODE: 'WHILE' }, { BOOL: cond, DO: body })
export const until = (cond, body) => b('controls_whileUntil', { MODE: 'UNTIL' }, { BOOL: cond, DO: body })

/** if / else if ... / else: pairs of [condition, statements], then the else. */
export function ifElse(pairs, otherwise) {
  const inputs = {}
  pairs.forEach(([cond, body], i) => {
    inputs[`IF${i}`] = cond
    inputs[`DO${i}`] = body
  })
  if (otherwise) inputs.ELSE = otherwise
  const extra = {}
  if (pairs.length > 1) extra.elseIfCount = pairs.length - 1
  if (otherwise) extra.hasElse = true
  return b('controls_if', {}, inputs, Object.keys(extra).length ? extra : undefined)
}

const OPS = { '=': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' }
export const compare = (a, op, c) => b('logic_compare', { OP: OPS[op] }, { A: a, B: c })
export const or = (a, c) => b('logic_operation', { OP: 'OR' }, { A: a, B: c })
export const and = (a, c) => b('logic_operation', { OP: 'AND' }, { A: a, B: c })
export const not = (a) => b('logic_negate', {}, { BOOL: a })

const MATH = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE' }
export const math = (a, op, c) => b('math_arithmetic', { OP: MATH[op] }, { A: a, B: c })
export const random = (from, to) => b('math_random_int', {}, { FROM: from, TO: to })
export const round = (a) => b('math_round', { OP: 'ROUND' }, { NUM: a })
export const join = (...items) =>
  b('text_join', {}, Object.fromEntries(items.map((v, i) => [`ADD${i}`, v])), { itemCount: items.length })

/**
 * A whole program: what runs once at the start, then what runs forever.
 * `variables` maps each variable's key to its (translated) name. The app
 * lines the stacks up when it loads one (workspace cleanUp).
 */
export function program({ start = [], forever = [], variables = {} }) {
  const blocks = []
  if (start.length) blocks.push({ ...b('ocb_on_start', {}, { DO: start }), x: 40, y: 40 })
  if (forever.length) blocks.push({ ...b('ocb_forever', {}, { DO: forever }), x: 40, y: 300 })
  const vars = Object.entries(variables).map(([key, name]) => ({ name, id: varId(key) }))
  return { blocks: { languageVersion: 0, blocks }, ...(vars.length ? { variables: vars } : {}) }
}
