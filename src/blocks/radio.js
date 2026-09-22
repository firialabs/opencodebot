/**
 * 2.4GHz radio, shared by CodeX and CodeAIR. Great for classroom projects
 * where two devices talk to each other without any Wi-Fi.
 */
import { Order } from 'blockly/python'
import { defineBlocks, value, body, numField } from './define.js'
import { need } from './context.js'

defineBlocks([
  {
    json: {
      type: 'radio_on',
      message0: '🛜 turn radio on, channel %1',
      args0: [{ type: 'field_number', name: 'CHANNEL', value: 5, min: 0, max: 13 }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
      tooltip: 'Devices only hear each other when they share a channel.',
    },
    python: (block) => {
      need('radio')
      return `radio.on()\nradio.config(channel=${numField(block, 'CHANNEL', 5)})\n`
    },
  },
  {
    json: {
      type: 'radio_send',
      message0: '🛜 radio send %1',
      args0: [{ type: 'input_value', name: 'MSG' }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
      tooltip: 'Send a short message to every device on the same channel.',
    },
    python: (block, gen) => {
      need('radio')
      return `radio.send(str(${value(gen, block, 'MSG', "''")}))\n`
    },
  },
  {
    json: {
      type: 'radio_on_message',
      message0: '🛜 when a radio message arrives, call it %1',
      args0: [{ type: 'field_variable', name: 'MSG', variable: 'message' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      nextStatement: null,
      style: 'radio_blocks',
      tooltip: 'Checks for a message. The blocks inside only run when one arrived.',
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
      message0: '🛜 radio message (or nothing)',
      output: null,
      style: 'radio_blocks',
      tooltip: 'Takes the next waiting message, or gives back nothing.',
    },
    python: () => {
      need('radio')
      return ['radio.receive()', Order.FUNCTION_CALL]
    },
  },
])
