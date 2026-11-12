/**
 * The string table: lookups, placeholders, escaping, counts, lists, and that
 * every key the code asks for is in English.
 *   node tests/i18n.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { t, listOf } from '../src/i18n/index.js'
import en from '../src/i18n/en.js'

let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}

console.log('strings')

test('a plain key', () => assert.equal(t('btn.run'), 'Run'))
test('placeholders, and {app} is the product name', () => {
  assert.equal(t('saved.detail', { file: 'a.ocb' }), 'Look in your Downloads folder for a.ocb.')
  assert.equal(t('about.title'), `About ${en['app.name']}`)
})
test('numbers are formatted', () => assert.equal(t('status.sendingPct', { pct: 1234 }), 'Sending your program… 1,234%'))
test('an Html key escapes its placeholders', () => {
  assert.ok(t('pick.switchBodyHtml', { names: '<b>', device: 'CodeX' }).includes('&lt;b&gt;'))
})
test('a missing key shows as itself', () => assert.equal(t('no.such.key'), 'no.such.key'))
test('a list joins as the language does', () => assert.equal(listOf(['CodeX', 'CodeAIR']), 'CodeX and CodeAIR'))

// Every literal key passed to t() in src/ is in en.js (keys built at run time,
// such as `status.${state}`, are listed by hand below).
test('every key the code uses is in English', () => {
  const missing = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) {
        if (p !== path.join('src', 'i18n')) walk(p)   // its comments hold examples
      }
      else if (/\.(js|html)$/.test(f.name)) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) if (!(m[1] in en)) missing.push(`${p}: ${m[1]}`)
        for (const m of src.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)) if (!(m[1] in en)) missing.push(`${p}: ${m[1]}`)
        for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
          for (const pair of m[1].split(';')) {
            const key = pair.split('=')[1]?.trim()
            if (key && !(key in en)) missing.push(`${p}: ${key}`)
          }
        }
      }
    }
  }
  walk('src')
  const html = fs.readFileSync('index.html', 'utf8')
  for (const m of html.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)) if (!(m[1] in en)) missing.push(`index.html: ${m[1]}`)
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.split('=')[1]?.trim()
      if (key && !(key in en)) missing.push(`index.html: ${key}`)
    }
  }
  for (const k of ['status.offline', 'status.connecting', 'status.ready', 'status.loading', 'status.running', 'status.error']) {
    if (!(k in en)) missing.push(k)
  }
  assert.deepEqual(missing, [])
})

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll good.')
