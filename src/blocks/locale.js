/**
 * Blockly's own words (its built-in blocks, menus, the toolbox's labels) in
 * the app's language. Imported before any block is defined.
 */
import * as Blockly from 'blockly/core'
import * as En from 'blockly/msg/en'
import * as Es from 'blockly/msg/es'
import { language, PSEUDO, pseudo } from '../i18n/index.js'

const BLOCKLY = { en: En, es: Es }

// Importing blockly/core on its own leaves the message table empty, which
// breaks everything from tooltips to the toolbox's aria labels. English
// first, so anything a translation leaves out still has words.
Blockly.setLocale(En)
if (BLOCKLY[language] && language !== 'en') Blockly.setLocale(BLOCKLY[language])
if (language === PSEUDO) {
  for (const [name, text] of Object.entries(Blockly.Msg)) {
    // A message that only points at another (%{BKY_...}) gets its words there.
    if (typeof text === 'string' && !/^%\{BKY_\w+\}$/.test(text)) Blockly.Msg[name] = pseudo(text)
  }
}
