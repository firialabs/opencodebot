import * as Blockly from 'blockly/core'
import { pythonGenerator, Order } from 'blockly/python'

/**
 * Register a list of `{ json, python }` block definitions.
 * Keeping the shape and the code side by side makes each block readable in
 * one place, which matters a lot when contributors are adding new hardware.
 */
export function defineBlocks(defs) {
  Blockly.defineBlocksWithJsonArray(defs.map((d) => d.json))
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
