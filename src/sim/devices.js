// The simulated devices: each kind's model and its bridge to Python.
import { CodeBot } from './world/codebot.js'
import { codebotBridge } from './bridge/codebot.js'
import { CodeX } from './world/codex.js'
import { codexBridge } from './bridge/codex.js'
import { CodeAIR } from './world/codeair.js'
import { codeairBridge } from './bridge/codeair.js'

export const KINDS = {
  codebot: {
    label: 'CodeBot',
    create(env, rng, spawn) {
      const bot = new CodeBot(env, rng, spawn)
      bot.bridge = codebotBridge(bot)
      return bot
    },
  },
  codex: {
    label: 'CodeX',
    create(env, rng) {
      const cx = new CodeX(env, rng)
      cx.bridge = codexBridge(cx)
      return cx
    },
  },
  codeair: {
    label: 'CodeAIR',
    create(env, rng, spawn) {
      const air = new CodeAIR(env, rng, spawn)
      air.bridge = codeairBridge(air)
      return air
    },
  },
}

export function createDevice(kind, env, rng, spawn = {}) {
  const k = KINDS[kind]
  if (!k) throw new Error(`no simulated device "${kind}"`)
  return k.create(env, rng, spawn)
}
