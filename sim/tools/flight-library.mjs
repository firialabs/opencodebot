// CodeAIR's flight library (Firia's port of cflib, GPL-2.0-or-later) is not in
// this repository. A build that wants CodeAIR flight (SIM_FLIGHT=1) fetches it
// from the repository and commit that sim/flight-library.json names, into
// sim/build/flight/ (ignored), and the site bundles it from there. Without the
// flag the simulator offers CodeBot and CodeX, and says flight is coming.
//
//   SIM_FLIGHT=1 node sim/tools/flight-library.mjs     fetch it (npm run sim:flight)
//
// Also imported by vite.config.js and src/sim/headless.js, which read what
// was fetched.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CONFIG_FILE = path.join(ROOT, 'sim/flight-library.json')
export const FLIGHT_DIR = path.join(ROOT, 'sim/build/flight')

export function flightConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
}

// Whether this build includes CodeAIR flight.
export function flightWanted(env = process.env) {
  return env.SIM_FLIGHT === '1'
}

// What was fetched, if it is what the config names now: { files, license,
// source } with files keyed as the device sees them ('cflib/commander.py').
// null if nothing was fetched, or it is from another repository or commit.
export function fetchedFlight() {
  const cfg = flightConfig()
  let source
  try {
    source = JSON.parse(fs.readFileSync(path.join(FLIGHT_DIR, 'source.json'), 'utf8'))
  } catch {
    return null
  }
  if (source.url !== cfg.url || source.commit !== cfg.commit) return null
  // A fetch cut short (cflib/ or the licence missing) is as good as none.
  try {
    const files = {}
    const dir = path.join(FLIGHT_DIR, 'cflib')
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.py')) files[`cflib/${f}`] = fs.readFileSync(path.join(dir, f), 'utf8')
    }
    if (!('cflib/__init__.py' in files)) return null
    return { files, license: fs.readFileSync(path.join(FLIGHT_DIR, 'COPYING'), 'utf8'), source }
  } catch {
    return null
  }
}

class FetchError extends Error {}

export function fetchFlight() {
  const cfg = flightConfig()
  if (!/^[0-9a-f]{40}$/.test(cfg.commit)) {
    throw new FetchError(`sim/flight-library.json pins no commit (a full 40-character SHA of ${cfg.url}), so CodeAIR flight cannot be fetched. Pin one, or build without SIM_FLIGHT.`)
  }
  if (fetchedFlight()) return
  const work = path.join(ROOT, 'sim/build/flight-fetch')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('init', '-q')
    git('fetch', '-q', '--depth', '1', cfg.url, cfg.commit)
    git('checkout', '-q', 'FETCH_HEAD')
  } catch (e) {
    throw new FetchError(`could not fetch ${cfg.url} at ${cfg.commit}:\n${String(e.stderr || e.message).trim()}`)
  }
  const src = path.join(work, cfg.folder)
  const py = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => f.endsWith('.py')) : []
  if (!py.includes('__init__.py')) throw new FetchError(`${cfg.url} at ${cfg.commit} has no ${cfg.folder}/__init__.py: is that Firia's port?`)
  if (!fs.existsSync(path.join(work, cfg.license))) throw new FetchError(`${cfg.url} at ${cfg.commit} has no ${cfg.license}`)
  fs.rmSync(FLIGHT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(FLIGHT_DIR, 'cflib'), { recursive: true })
  for (const f of py) fs.copyFileSync(path.join(src, f), path.join(FLIGHT_DIR, 'cflib', f))
  fs.copyFileSync(path.join(work, cfg.license), path.join(FLIGHT_DIR, 'COPYING'))
  fs.writeFileSync(path.join(FLIGHT_DIR, 'source.json'), JSON.stringify({ url: cfg.url, commit: cfg.commit }, null, 2) + '\n')
  fs.rmSync(work, { recursive: true, force: true })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!flightWanted()) {
    console.log('CodeAIR flight left out of this build (set SIM_FLIGHT=1 to include it).')
  } else {
    try {
      fetchFlight()
      const { source, files } = fetchedFlight()
      console.log(`CodeAIR flight: ${Object.keys(files).length} modules from ${source.url} at ${source.commit}`)
    } catch (e) {
      console.error(`\nCodeAIR flight: ${e.message}\n`)
      process.exit(1)
    }
  }
}
