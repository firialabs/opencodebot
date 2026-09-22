/**
 * Turns the workspace into a complete, runnable CircuitPython program.
 *
 * Blocks only emit the line they are about; this assembles the imports and
 * one-time setup around them, in the order the firmware needs. (On CodeX,
 * `import radio` genuinely has to come before `from codex import *`.)
 */
import { pythonGenerator } from 'blockly/python'
import { resetNeeds, allNeeds } from './context.js'
import { getTarget } from '../device/targets.js'

const DEVICE_IMPORT = {
  codex: 'from codex import *',
  codebot: 'from botcore import *',
  codeair: 'from codeair import *',
}

const NEED_FOR_DEVICE = { codex: 'codex', codebot: 'botcore', codeair: 'codeair' }

const BANNER = '# Made with OpenCodeBot 💚 — blocks in, Python out.'

export function generatePython(workspace, targetId) {
  resetNeeds()
  const program = pythonGenerator.workspaceToCode(workspace).trim()
  const needs = allNeeds()

  const header = [BANNER]
  const target = getTarget(targetId)
  if (target) header.push(`# Device: ${target.fullName}`)
  header.push('')

  // Radio reserves internal memory, so it must be imported first of all.
  if (needs.has('radio')) header.push('import radio')
  // Driven by the blocks actually used, not by the picker: a project full of
  // CodeX blocks still generates CodeX imports if the picker says otherwise.
  for (const [key, line] of Object.entries(DEVICE_IMPORT)) {
    if (needs.has(NEED_FOR_DEVICE[key])) header.push(line)
  }
  if (needs.has('colors')) header.push('from colors import *')
  if (needs.has('flight')) header.push('from flight import *')
  if (needs.has('songplayer')) header.push('from songplayer import song_player')
  if (needs.has('time')) header.push('import time')

  const setup = []
  if (needs.has('motors_enable')) setup.push('motors.enable(True)')

  if (!program) {
    return `${header.join('\n').trim()}\n\n# Add some blocks and press Run!\n`
  }

  return [header.join('\n').trim(), setup.join('\n'), program]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n')
}

/** Devices whose blocks appear in a workspace, by block-type prefix. */
export function devicesUsed(workspace) {
  const used = new Set()
  for (const block of workspace.getAllBlocks(false)) {
    for (const id of Object.keys(DEVICE_IMPORT)) {
      if (block.type.startsWith(`${id}_`)) used.add(id)
    }
  }
  return used
}

/** Very small Python highlighter for the read-only "Python" tab. */
const KEYWORDS =
  'and|as|break|class|continue|def|elif|else|except|False|finally|for|from|if|' +
  'import|in|is|None|not|or|pass|raise|return|True|try|while|with'

export function highlightPython(source) {
  // One pass, so a keyword inside a string (or a span we just emitted) is
  // never re-highlighted.
  const token = new RegExp(
    `(#[^\\n]*)|('(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*")|\\b(${KEYWORDS})\\b|(\\b\\d+\\.?\\d*\\b)`,
    'g',
  )
  let out = ''
  let last = 0
  let match
  while ((match = token.exec(source))) {
    out += escapeHtml(source.slice(last, match.index))
    const cls = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'k' : 'n'
    out += `<span class="${cls}">${escapeHtml(match[0])}</span>`
    last = token.lastIndex
  }
  return out + escapeHtml(source.slice(last))
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
