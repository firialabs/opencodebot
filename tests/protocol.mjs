/**
 * Protocol tests that need no hardware and no browser.
 *
 * The important one is the file transfer: the chunks we send are Python
 * source, so we hand them to a real Python interpreter and check that what
 * the device would have written matches the program byte for byte.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repl } from '../src/device/repl.js'
import { ConsoleFilter } from '../src/device/console-filter.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok  ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    failures++
  }
}

const latin1 = (bytes) => String.fromCharCode(...bytes)
const bytes = (...values) => Uint8Array.from(values)

// ------------------------------------------------------------ console filter
console.log('ConsoleFilter')
{
  const replies = []
  const filter = new ConsoleFilter((data) => replies.push(data))
  const enc = (s) => new TextEncoder().encode(s)

  check(
    'passes ordinary output through',
    latin1(filter.push(enc('hello\r\n'))) === 'hello\r\n',
  )

  // 0xC2 0xAB ... 0xC2 0xBB brackets debugger chatter.
  const withDebug = Uint8Array.from([
    ...enc('a'), 0xc2, 0xab, ...enc('block=x file=y line=3'), 0xc2, 0xbb, ...enc('b'),
  ])
  check('drops debugger chatter', latin1(filter.push(withDebug)) === 'ab')

  // Split across two reads, the way real serial data arrives.
  filter.reset()
  const first = filter.push(Uint8Array.from([...enc('a'), 0xc2]))
  const second = filter.push(Uint8Array.from([0xab, ...enc('noise'), 0xc2, 0xbb, ...enc('b')]))
  check('handles an escape split across reads', latin1(first) + latin1(second) === 'ab')

  // C0DECAFE + length with a high byte of 0x01 is the device's ping.
  filter.reset()
  replies.length = 0
  const ping = bytes(0xc0, 0xde, 0xca, 0xfe, 0x01, 0x00, 0x00, 0x00)
  check('swallows the ping', filter.push(ping).length === 0)
  check('answers the ping', replies.length === 1 && latin1(replies[0]) === 'OK\r')

  // A real blob is dropped, and normal output resumes straight after.
  filter.reset()
  const blob = Uint8Array.from([0xc0, 0xde, 0xca, 0xfe, 0, 0, 0, 3, 1, 2, 3, ...enc('done')])
  check('drops an embedded-data blob', latin1(filter.push(blob)) === 'done')

  // Four bytes that merely start like the magic must survive untouched.
  filter.reset()
  check(
    'keeps output that only looks like a blob header',
    latin1(filter.push(Uint8Array.from([0xc0, 0xde, 0xca, 0x41, ...enc('x')]))) ===
      latin1(Uint8Array.from([0xc0, 0xde, 0xca, 0x41, ...enc('x')])),
  )
}

// -------------------------------------------------------------- file transfer
console.log('Repl.writeFile')
{
  const source = [
    "print('quotes and \\\\ backslashes')",
    'text = "she said \'hi\'"',
    "trailing = 'ends with a quote:'",
    '# a long line to force a second chunk: ' + 'x'.repeat(1200),
    "emoji = '💚 ünïcode'",
    "doc = '''a triple-quoted string, right in the source'''",
    'other = ' + '"'.repeat(3) + 'double triple' + '"'.repeat(3),
    '',
  ].join('\n')

  const sent = []
  const fakeLink = {
    send(data) {
      sent.push(data)
      // Every raw-REPL submission is answered with a prompt.
      queueMicrotask(() => repl.feed('\r\nOK\x04\x04>'))
      return Promise.resolve()
    },
  }
  const repl = new Repl(fakeLink)
  await repl.writeFile('main.py', source)

  const writes = sent
    .join('')
    .split('\x04')
    .map((line) => line.trim())
    .filter((line) => line.startsWith("w('''"))
  check('splits into chunks', writes.length >= 2, `(got ${writes.length})`)

  const dir = mkdtempSync(join(tmpdir(), 'ocb-'))
  const outPath = join(dir, 'out.bin')
  const script = [
    'import io',
    '_buf = io.BytesIO()',
    'def w(data): _buf.write(data)',
    ...writes,
    `open(${JSON.stringify(outPath)}, "wb").write(_buf.getvalue())`,
  ].join('\n')
  writeFileSync(join(dir, 'replay.py'), script)
  execFileSync('python3', [join(dir, 'replay.py')])

  const rebuilt = readFileSync(outPath, 'utf8')
  check('device would reconstruct the program exactly', rebuilt === source, `\n--- got ---\n${rebuilt}\n--- want ---\n${source}`)
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll good.')
process.exit(failures ? 1 : 0)
