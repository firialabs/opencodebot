/**
 * Strips the Firia Labs debugger's out-of-band chatter from the byte stream
 * before it reaches the terminal, so students only ever see their own output.
 *
 * The firmware brackets debugger traffic with escape bytes, and can push
 * "embedded data" blobs (charts, images) that CodeSpace renders and we simply
 * drop. The one thing we must answer is the device's ping, or it stalls.
 *
 *   0xC2 0xAB ... 0xC2 0xBB   debugger output (dropped)
 *   0xC2 0xB7                 variable-report prefix (dropped to end marker)
 *   C0 DE CA FE + u32 len     embedded data blob (dropped, ack'd every 1KiB)
 *   ...with a high length byte of 0x01 meaning "ping me back"
 */

const ESC = 0xc2
const ENTER_DEBUG = 0xab
const EXIT_DEBUG = 0xbb
const VAR_PREFIX = 0xb7
const EDATA_MAGIC = [0xc0, 0xde, 0xca, 0xfe]
const ACK = 0x06
const ACK_EVERY = 1024

const ST_ON = 0
const ST_ON_ESC = 1
const ST_OFF = 2
const ST_OFF_ESC = 3
const ST_MAGIC = 4
const ST_LEN = 5
const ST_BLOB = 6

export class ConsoleFilter {
  /** @param {(bytes: Uint8Array) => void} reply used to ack / answer pings */
  constructor(reply) {
    this._reply = reply || (() => {})
    this.reset()
  }

  reset() {
    this._state = ST_ON
    this._scratch = []
    this._blobLeft = 0
    this._unacked = 0
  }

  /** Drop the debugger back into "show everything" mode. */
  suppressDebug(on) {
    this._state = on ? ST_OFF : ST_ON
  }

  /** True while debugger output is being swallowed. */
  get suppressed() {
    return this._state === ST_OFF || this._state === ST_OFF_ESC
  }

  /**
   * @param {Uint8Array} bytes raw from the serial port
   * @returns {Uint8Array} what the terminal should show
   */
  push(bytes) {
    const out = new Uint8Array(bytes.length)
    let n = 0

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]

      switch (this._state) {
        case ST_ON:
          if (b === ESC) this._state = ST_ON_ESC
          else if (b === EDATA_MAGIC[0]) {
            this._scratch = [b]
            this._state = ST_MAGIC
          } else out[n++] = b
          break

        case ST_ON_ESC:
          if (b === ENTER_DEBUG || b === VAR_PREFIX) this._state = ST_OFF
          else {
            out[n++] = ESC
            out[n++] = b
            this._state = ST_ON
          }
          break

        case ST_OFF:
          if (b === ESC) this._state = ST_OFF_ESC
          break

        case ST_OFF_ESC:
          this._state = b === EXIT_DEBUG ? ST_ON : ST_OFF
          break

        case ST_MAGIC:
          this._scratch.push(b)
          if (this._scratch.length === 4) {
            if (this._scratch.every((v, k) => v === EDATA_MAGIC[k])) {
              this._scratch = []
              this._state = ST_LEN
            } else {
              for (const v of this._scratch) out[n++] = v
              this._scratch = []
              this._state = ST_ON
            }
          }
          break

        case ST_LEN:
          this._scratch.push(b)
          if (this._scratch.length === 4) {
            const len =
              ((this._scratch[0] << 24) |
                (this._scratch[1] << 16) |
                (this._scratch[2] << 8) |
                this._scratch[3]) >>> 0
            this._scratch = []
            if ((len >>> 24) === 0x01) {
              // Device is checking we are still here.
              this._reply(new TextEncoder().encode('OK\r'))
              this._state = ST_ON
            } else {
              this._blobLeft = len
              this._unacked = 0
              this._state = len > 0 ? ST_BLOB : ST_ON
            }
          }
          break

        case ST_BLOB:
          this._blobLeft--
          if (++this._unacked >= ACK_EVERY) {
            this._reply(new Uint8Array([ACK]))
            this._unacked -= ACK_EVERY
          }
          if (this._blobLeft <= 0) {
            this._unacked = 0
            this._state = ST_ON
          }
          break
      }
    }

    return out.subarray(0, n)
  }
}
