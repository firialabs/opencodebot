/**
 * 2.4GHz radio, shared by CodeX and CodeAIR. Great for classroom projects
 * where two devices talk to each other without any Wi-Fi.
 */
import { Order } from 'blockly/python'
import { defineBlocks, value, body, numField } from './define.js'
import { t } from '../i18n/index.js'
import { need } from './context.js'

defineBlocks([
  {
    json: {
      type: 'radio_on',
      args0: [{ type: 'field_number', name: 'CHANNEL', value: 5, min: 0, max: 13 }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
    },
    python: (block) => {
      need('radio')
      return `radio.on()\nradio.config(channel=${numField(block, 'CHANNEL', 5)})\n`
    },
  },
  {
    json: {
      type: 'radio_send',
      args0: [{ type: 'input_value', name: 'MSG' }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
    },
    python: (block, gen) => {
      need('radio')
      return `radio.send(str(${value(gen, block, 'MSG', "''")}))\n`
    },
  },
  {
    json: {
      type: 'radio_on_message',
      args0: [{ type: 'field_variable', name: 'MSG', variable: t('sample.radioVar') }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
    },
    python: (block, gen) => {
      need('radio')
      const name = gen.getVariableName(block.getFieldValue('MSG'))
      return `${name} = radio.receive()\nif ${name} is not None:\n${body(gen, block)}`
    },
  },
  {
    json: {
      type: 'radio_receive',
      output: null,
      style: 'radio_blocks',
    },
    python: () => {
      need('radio')
      return ['radio.receive()', Order.FUNCTION_CALL]
    },
  },
])
