/** Registering every block definition, once, at startup. */
import * as Blockly from 'blockly/core'
import * as En from 'blockly/msg/en'
import 'blockly/blocks'
// Swaps the gear-and-bubble mutators (if/else if, join, list, function
// inputs) for plain + and - buttons on the block. Dragging tiny blocks around
// inside a bubble is where young students and teachers got stuck.
import '@blockly/block-plus-minus'
import { pythonGenerator } from 'blockly/python'

// Importing blockly/core on its own leaves the message table empty, which
// breaks everything from tooltips to the toolbox's aria labels.
Blockly.setLocale(En)

// Four spaces, so the code in the Python tab looks like the Python students
// will go on to write by hand.
pythonGenerator.INDENT = '    '

import './basics.js'
import './codex.js'
import './codebot.js'
import './codeair.js'
import './radio.js'

export { toolboxFor } from './toolbox.js'
export { cuteTheme } from './theme.js'
export { generatePython, generateWithLines, highlightPython, devicesUsed } from './generate.js'
