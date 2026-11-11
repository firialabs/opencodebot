// The simulated devices: each kind's model and its bridge to Python.
import { CodeBot } from './world/codebot.js'
import { codebotBridge } from './bridge/codebot.js'

export const KINDS = {
  codebot: {
    label: 'CodeBot',
    create(env, rng, spawn) {
      const bot = new CodeBot(env, rng, spawn)
      bot.bridge = codebotBridge(bot)
      return bot
    },
  },
}

export function createDevice(kind, env, rng, spawn = {}) {
  const k = KINDS[kind]
  if (!k) throw new Error(`no simulated device "${kind}"`)
  return k.create(env, rng, spawn)
}
