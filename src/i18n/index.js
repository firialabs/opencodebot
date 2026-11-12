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
 */
import en from './en.js'

const TABLES = { en }
const SAVED = 'opencodebot.lang.v1'

export const LANGUAGES = Object.keys(TABLES)
export const language = pick()

const plural = new Intl.PluralRules(language)
const number = new Intl.NumberFormat(language)
const list = new Intl.ListFormat(language, { type: 'conjunction' })

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
    if (TABLES[tag]) return tag
    const base = tag.split('-')[0]
    if (TABLES[base]) return base
  }
  return 'en'
}

/** Save a language for next time and reload into it. */
export function setLanguage(lang) {
  try {
    localStorage.setItem(SAVED, lang)
  } catch { /* storage blocked: the choice lasts this page only */ }
  location.reload()
}

/**
 * The string for `key`, with `params` put into its {placeholders}. Numbers are
 * formatted for the language. A key ending in `Html` is HTML: its params are
 * escaped. `{app}` is always the product's name.
 */
export function t(key, params = {}) {
  let s = TABLES[language][key] ?? en[key] ?? key
  if (typeof s === 'object') s = s[plural.select(params.count ?? 0)] ?? s.other
  const html = key.endsWith('Html')
  return s.replace(/\{(\w+)\}/g, (whole, name) => {
    const v = name === 'app' && !(name in params) ? (TABLES[language]['app.name'] ?? en['app.name']) : params[name]
    if (v === undefined) return whole
    const text = typeof v === 'number' ? number.format(v) : String(v)
    return html ? escapeHtml(text) : text
  })
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
