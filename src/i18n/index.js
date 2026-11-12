/**
 * Every string a student or teacher sees, in one table per language
 * (src/i18n/<lang>.js), looked up by key. How to add a string or a language:
 * README.md, "Strings and languages".
 *
 *   t('status.ready')                         → "Ready"
 *   t('run.wrongDevice', { names, device })   → placeholders in {braces}
 *   t('sim.robots', { count: 3 })             → { one, other } by count
 *
 * The language is settled once, when this module loads: `?lang=` in the
 * address, then the one saved by setLanguage(), then the browser's own
 * languages, then English. Changing it reloads the page, so tables built at
 * load time (the toolbox, the device list) need no rebuilding. A key missing
 * from a language falls back to English, and a key missing from English shows
 * as the key itself, so a gap is visible rather than blank.
 *
 * `?lang=en-XA` is a pseudo-language for testing: English with every letter
 * accented and each string in ⟦ ⟧. Text that shows up plain was not looked up
 * here (tests/pseudo.mjs checks the whole app this way).
 */
import en from './en.js'
import es from './es.js'

const TABLES = { en, es }
const SAVED = 'opencodebot.lang.v1'
export const PSEUDO = 'en-XA'

/** The languages a person can pick, each named in its own language. */
export const LANGUAGES = Object.keys(TABLES)
export const language = pick()
const table = TABLES[language] ?? en

const plural = new Intl.PluralRules(language)
const number = new Intl.NumberFormat(language)
const list = new Intl.ListFormat(language, { type: 'conjunction' })

/** A language's own name for itself, from its table: "Español". */
export function languageName(lang) {
  return TABLES[lang]?.['lang.name'] ?? lang
}

/** A number with exactly `digits` decimals, as the language writes it: "0.5". */
export function fixed(value, digits) {
  return new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Items joined as the language joins a list: "CodeX and CodeAIR". */
export function listOf(items) {
  return list.format(items.map(String))
}

function pick() {
  const wanted = []
  try {
    wanted.push(new URL(globalThis.location?.href).searchParams.get('lang'))
  } catch { /* not in a browser */ }
  try {
    wanted.push(globalThis.localStorage?.getItem(SAVED))
  } catch { /* storage blocked */ }
  wanted.push(...(globalThis.navigator?.languages ?? []))
  for (const tag of wanted) {
    if (!tag) continue
    if (tag === PSEUDO) return tag
    if (TABLES[tag]) return tag
    const base = tag.split('-')[0]
    if (TABLES[base]) return base
  }
  return 'en'
}

/** Save a language for next time and reload into it. */
export function setLanguage(lang) {
  const url = new URL(location.href)
  url.searchParams.delete('lang') // or the address would win over the choice
  try {
    localStorage.setItem(SAVED, lang)
  } catch {
    url.searchParams.set('lang', lang) // storage blocked: carry it in the address
  }
  location.assign(url)
}

/**
 * The string for `key`, with `params` put into its {placeholders}. Numbers are
 * formatted for the language. A key ending in `Html` is HTML: its params are
 * escaped. `{app}` is always the product's name.
 */
export function t(key, params = {}) {
  let s = table[key] ?? en[key] ?? key
  if (typeof s === 'object') s = s[plural.select(params.count ?? 0)] ?? s.other
  if (language === PSEUDO && s !== key) s = pseudo(s)
  const html = key.endsWith('Html')
  return s.replace(/\{(\w+)\}/g, (whole, name) => {
    const v = name === 'app' && !(name in params) ? t('app.name') : params[name]
    if (v === undefined) return whole
    const text = typeof v === 'number' ? number.format(v) : String(v)
    return html ? escapeHtml(text) : text
  })
}

/** A string made safe to put in HTML markup, for templates built in code. */
export function tHtml(key, params) {
  return escapeHtml(t(key, params))
}

/**
 * Fill the page's own markup from the table:
 *   data-i18n="key"                      its text
 *   data-i18n-html="key"                 its HTML (a key ending in Html)
 *   data-i18n-attr="title=key;aria-label=key"   attributes
 */
export function translatePage(root = document) {
  document.documentElement.lang = language
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml)
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split('=').map((s) => s.trim())
      if (attr && key) el.setAttribute(attr, t(key))
    }
  }
}

const ACCENTED = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ṁ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}

/**
 * A string in the pseudo-language: every letter accented, the whole in ⟦ ⟧.
 * What the code fills in or reads is left alone: {placeholders}, Blockly's %1
 * and %{BKY_...}, HTML tags and entities.
 */
export function pseudo(s) {
  if (typeof s !== 'string' || !s.trim()) return s
  const body = s.replace(/(\{\w+\}|%\{\w+\}|%\d+|<[^>]*>|&#?\w+;)|([A-Za-z])/g, (m, keep, letter) =>
    keep ?? ACCENTED[letter],
  )
  return `⟦${body}⟧`
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
