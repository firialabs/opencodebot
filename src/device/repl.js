/**
 * Talking to a Firia Labs board over its CircuitPython REPL.
 *
 * The protocol is the same one CodeSpace uses: drop into the raw REPL, write
 * the program to main.py a chunk at a time, then soft-reboot so the board
 * runs it. Everything here works on a latin-1 view of the byte stream, so a
 * multi-byte character can never split a match.
 */

export const CTRL_A = '\x01' // enter raw REPL
export const CTRL_B = '\x02' // exit raw REPL
export const CTRL_C = '\x03' // interrupt
export const CTRL_D = '\x04' // submit (raw) / soft reboot (friendly)

export const REPL_PROMPT = '>>> '
export const DEBUG_PROMPT = '<<< '

const CHUNK_SIZE = 1024
const DEFAULT_TIMEOUT = 4000
/** Keep only enough tail to span a prompt split across two serial reads. */
const MATCH_TAIL = 4096

export class ReplTimeout extends Error {
  constructor(what) {
    super(`Timed out waiting for ${what}`)
    this.name = 'ReplTimeout'
  }
}

export class ReplAborted extends Error {
  constructor() {
    super('Interrupted')
    this.name = 'ReplAborted'
  }
}

export class Repl {
  /** @param {{send: (data: string|Uint8Array) => Promise<void>}} link */
  constructor(link) {
    this.link = link
    this._pending = null
    this._watchers = new Set()
    this.aborted = false
  }

  /** Feed decoded (latin-1) serial text in. Called for every read. */
  feed(text) {
    if (this._pending) {
      this._pending.buf += text
      if (this._pending.buf.length > MATCH_TAIL) {
        this._pending.buf = this._pending.buf.slice(-MATCH_TAIL)
      }
      if (this._pending.expect.test(this._pending.buf)) {
        const { resolve, buf } = this._pending
        this._pending = null
        resolve(buf)
      }
    }

    for (const watcher of [...this._watchers]) {
      watcher.buf = (watcher.buf + text).slice(-MATCH_TAIL)
      if (watcher.expect.test(watcher.buf)) {
        this._watchers.delete(watcher)
        watcher.resolve(watcher.buf)
      }
    }
  }

  /** Resolve once `expect` shows up in the stream (no writing involved). */
  waitFor(expect, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const watcher = { expect, buf: '', resolve }
      this._watchers.add(watcher)
      setTimeout(() => {
        if (this._watchers.delete(watcher)) reject(new ReplTimeout(String(expect)))
      }, timeout)
    })
  }

  /** Abandon anything in flight — used when the user hits Stop. */
  cancelPending(reason = new ReplAborted()) {
    this.aborted = true
    if (this._pending) {
      const { reject } = this._pending
      this._pending = null
      reject(reason)
    }
    for (const watcher of this._watchers) watcher.resolve?.('')
    this._watchers.clear()
  }

  resume() {
    this.aborted = false
  }

  /**
   * Send `cmd` and wait for `expect`. Resolves with everything received, or
   * throws ReplTimeout. The write is inside the race on purpose: a wedged
   * board stops draining USB and a blocked write would otherwise hang us.
   */
  async send(cmd, { expect = />/, submit = false, timeout = DEFAULT_TIMEOUT } = {}) {
    if (this.aborted) throw new ReplAborted()

    const payload = submit ? cmd + CTRL_D : cmd
    let timer
    const answer = new Promise((resolve, reject) => {
      this._pending = { expect, buf: '', resolve, reject }
      timer = setTimeout(() => {
        if (this._pending) {
          this._pending = null
          reject(new ReplTimeout(String(expect)))
        }
      }, timeout)
    })
    // Nothing awaits `answer` until the write below settles; absorb an early
    // rejection so it can never surface as an unhandled rejection.
    answer.catch(() => {})

    try {
      await this.link.send(payload)
      return await answer
    } finally {
      clearTimeout(timer)
      this._pending = null
    }
  }

  /** Try to get back to a friendly `>>>` prompt. Returns true if we did. */
  async interrupt({ tries = 4, timeout = 900 } = {}) {
    this.resume()
    for (let i = 0; i < tries; i++) {
      try {
        await this.send(CTRL_B + CTRL_C, { expect: />>> /, timeout })
        return true
      } catch (err) {
        if (err instanceof ReplAborted) throw err
      }
    }
    return false
  }

  /**
   * Write `source` to `filename` on the board using the raw REPL.
   * @param {(fraction: number) => void} [onProgress]
   */
  async writeFile(filename, source, onProgress) {
    const body = source.replace(/\r\n/g, '\n')

    await this.send(CTRL_A, { expect: />/, timeout: 3000 })
    await this.send(`fd=open(${JSON.stringify(filename)}, "wb")`, { submit: true })
    await this.send('w=fd.write', { submit: true })

    for (let i = 0; i < body.length; i += CHUNK_SIZE) {
      // Each chunk travels inside a triple-quoted Python literal. Escaping
      // every backslash and every quote keeps the student's own source
      // completely untouched — even if it contains ''' itself.
      const chunk = body
        .substr(i, CHUNK_SIZE)
        .replace(/\\/g, '\\x5c')
        .replace(/'/g, "\\'")
      const reply = await this.send(`w('''${chunk}'''.encode('utf-8'))`, {
        submit: true,
        timeout: 6000,
      })
      if (reply.includes('Traceback')) throw new Error(replErrorText(reply))
      onProgress?.(Math.min(1, (i + CHUNK_SIZE) / Math.max(1, body.length)))
    }

    await this.send('fd.close()', { submit: true })
    // Flush to flash where the port supports it; harmless where it does not.
    await this.send('try:\n import os\n os.sync()\nexcept Exception: pass', {
      submit: true,
      timeout: 6000,
    })
    await this.send(CTRL_B, { expect: />>>|\r\n/, timeout: 3000 })
    onProgress?.(1)
  }
}

/** Pull the useful line out of a raw-REPL traceback. */
export function replErrorText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  return last && last !== '>' ? last : 'The device reported an error.'
}
