import './styles/theme.css'
import './styles/app.css'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'

import * as Blockly from 'blockly/core'
import { toolboxFor, generatePython } from './blocks/index.js'
import { App } from './ui/app.js'

window.addEventListener('DOMContentLoaded', () => {
  window.openCodeBot = new App()
  // Handy from the browser console, and used by the automated smoke tests.
  window.openCodeBotInternals = { Blockly, toolboxFor, generatePython }
})
