/**
 * The string table: lookups, placeholders, escaping, counts, lists, and that
 * every key the code asks for is in English.
 *   node tests/i18n.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { t, listOf, pseudo, LANGUAGES } from '../src/i18n/index.js'
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
        for (const m of src.matchAll(/\b(?:t|tHtml|msg)\('([\w.]+)'/g)) if (!(m[1] in en)) missing.push(`${p}: ${m[1]}`)
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
  for (const page of ['index.html', 'boards.html']) {
    const html = fs.readFileSync(page, 'utf8')
    for (const m of html.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)) if (!(m[1] in en)) missing.push(`${page}: ${m[1]}`)
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(';')) {
        const key = pair.split('=')[1]?.trim()
        if (key && !(key in en)) missing.push(`${page}: ${key}`)
      }
    }
  }
  const built = [
    ...['offline', 'connecting', 'ready', 'loading', 'running', 'error'].map((s) => `status.${s}`),
    ...['still', 'moving', 'backing', 'turnLeft', 'turnRight'].map((m) => `doing.${m}`),
    ...['backing', 'turnLeft', 'turnRight'].map((m) => `say.${m}`),
    ...['east', 'northEast', 'north', 'northWest', 'west', 'southWest', 'south', 'southEast'].map((c) => `compass.${c}`),
    'codex.up', 'codex.left', 'codex.right', 'codex.down',
    'simPanel.camChase', 'simPanel.camOrbit', 'simPanel.camTop',
    ...['motors', 'speaker', 'effects', 'music'].flatMap((b) => [`settings.${b}`, `settings.${b}Hint`]),
    ...['low', 'medium', 'high', 'ultra'].map((l) => `settings.level.${l}`),
    'music.creditKidFears',
    'example.remote', 'example.listener', 'example.codeairRemote', 'example.xfly', 'example.lights',
  ]
  for (const k of built) if (!(k in en)) missing.push(k)
  assert.deepEqual(missing, [])
})

// The blocks' words: block.<type>.message0 and on, and block.<type>.tooltip
// (src/blocks/define.js fills them in by type).
test('every block has its words, and every block string has a block', () => {
  const types = new Set()
  for (const f of fs.readdirSync('src/blocks')) {
    for (const m of fs.readFileSync(path.join('src/blocks', f), 'utf8').matchAll(/^ {6}type: '(\w+)',$/gm)) types.add(m[1])
  }
  assert.ok(types.size > 50, `found ${types.size} block types`)
  const orphans = Object.keys(en)
    .filter((k) => /^block\.\w+\.(message\d|tooltip)$/.test(k))
    .filter((k) => !types.has(k.split('.')[1]))
  assert.deepEqual(orphans, [], 'strings for blocks that no longer exist')
  const untipped = [...types].filter((type) => !(`block.${type}.tooltip` in en))
  assert.deepEqual(untipped, [], 'blocks with no tooltip in en.js')
})

// Each translation: only keys English has, and the same {placeholders} and
// %1, %2 (in any order) as the English, so nothing the code fills in is lost.
const marks = (v) =>
  [...(typeof v === 'object' ? Object.values(v).join('|') : String(v)).matchAll(/\{\w+\}|%\d+/g)]
    .map((m) => m[0])
    .sort()
    .join(' ')
for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
  const table = (await import(`../src/i18n/${lang}.js`)).default
  test(`${lang}: every key is one English has`, () => {
    assert.deepEqual(Object.keys(table).filter((k) => !(k in en)), [])
  })
  test(`${lang}: the same placeholders as English`, () => {
    const off = Object.keys(table).filter((k) => k in en && marks(table[k]) !== marks(en[k]))
    assert.deepEqual(off.map((k) => `${k}: ${marks(en[k])} -> ${marks(table[k])}`), [])
  })
  test(`${lang}: no em dashes`, () => {
    assert.deepEqual(Object.keys(table).filter((k) => JSON.stringify(table[k]).includes('\u2014')), [])
  })
}

test('the pseudo-language accents letters and keeps what the code fills in', () => {
  assert.equal(pseudo('Saved {file}.'), '⟦Šåṽéð {file}.⟧')
  assert.equal(pseudo('🤖 drive %1 at %2'), '⟦🤖 ðŕîṽé %1 åţ %2⟧')
  assert.equal(pseudo('<kbd>Ctrl</kbd> &amp; %{BKY_X}'), '⟦<kbd>Çţŕļ</kbd> &amp; %{BKY_X}⟧')
})

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll good.')
