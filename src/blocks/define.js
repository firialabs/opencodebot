import * as Blockly from 'blockly/core'
import { pythonGenerator, Order } from 'blockly/python'
import { t } from '../i18n/index.js'
import en from '../i18n/en.js'

/**
 * A string from the table, through Blockly's own message system: it goes into
 * Blockly.Msg, and the block refers to it as %{BKY_...}, as Blockly's built-in
 * blocks do. Use it for a dropdown's labels: `[msg('block.opt.on'), 'True']`.
 */
export function msg(key) {
  const name = 'OCB_' + key.replace(/\W/g, '_').toUpperCase()
  Blockly.Msg[name] = t(key)
  return `%{BKY_${name}}`
}

/**
 * A block's words come from the string table by its type:
 * `block.<type>.message0` (message1 and on, when the block has more lines)
 * and `block.<type>.tooltip`. See README, "Strings and languages".
 */
function fillMessages(json) {
  for (const part of ['tooltip', ...Array.from({ length: 10 }, (_, i) => `message${i}`)]) {
    const key = `block.${json.type}.${part}`
    if (key in en) json[part] = msg(key)
  }
  return json
}

/**
 * Register a list of `{ json, python }` block definitions.
 * Keeping the shape and the code side by side makes each block readable in
 * one place, which matters a lot when contributors are adding new hardware.
 */
export function defineBlocks(defs) {
  Blockly.defineBlocksWithJsonArray(defs.map((d) => fillMessages(d.json)))
  for (const def of defs) {
    pythonGenerator.forBlock[def.json.type] = def.python
  }
}

/** Value input as Python, falling back to `fallback` when nothing is plugged in. */
export function value(gen, block, name, fallback = '0', order = Order.NONE) {
  return gen.valueToCode(block, name, order) || fallback
}

/** Statement input as Python, always yielding at least a `pass`. */
export function body(gen, block, name = 'DO') {
  const code = gen.statementToCode(block, name)
  return code || gen.INDENT + 'pass\n'
}

/** A number typed straight into a field, safe for use in generated code. */
export function numField(block, name, fallback = 0) {
  const raw = Number(block.getFieldValue(name))
  return Number.isFinite(raw) ? raw : fallback
}
