/**
 * One interface for everything the app can run a program on: a board over
 * Web Serial today, a simulator tomorrow. The UI only ever talks to a
 * DeviceTarget, so a new kind of device plugs in without touching it.
 *
 * The full contract, with the events and their payloads, is written up in
 * docs/device-targets.md. Keep the two in step.
 *
 * @typedef {'offline'|'connecting'|'ready'|'loading'|'running'} DeviceState
 *
 * @typedef {EventTarget & {
 *   kind: string,
 *   supported: boolean,
 *   isConnected: boolean,
 *   state: DeviceState,
 *   targetId: string|null,
 *   firmware: {version: string, date: string}|null,
 *   connect(): Promise<boolean>,
 *   disconnect(): Promise<void>,
 *   autoConnect?(): Promise<boolean>,
 *   run(source: string): Promise<boolean>,
 *   stop(opts?: {quiet?: boolean}): Promise<boolean>,
 *   sendRaw(data: string|Uint8Array): void,
 *   writeFile(name: string, contents: string): Promise<boolean>,
 * }} DeviceTarget
 */

export const State = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  READY: 'ready',
  LOADING: 'loading',
  RUNNING: 'running',
}

/** Members every DeviceTarget must have. Used by the contract test. */
export const REQUIRED_METHODS = ['connect', 'disconnect', 'run', 'stop', 'sendRaw', 'writeFile']
export const REQUIRED_PROPS = ['kind', 'supported', 'isConnected', 'state', 'targetId']

/** Events a DeviceTarget dispatches (CustomEvent, payload in `detail`). */
export const EVENTS = ['state', 'device', 'data', 'notice', 'progress', 'program-error']

const kinds = new Map()

/**
 * Make a kind of device available. `factory` returns a new DeviceTarget.
 * Call it at module load time, before the app starts.
 */
export function registerDeviceKind(kind, factory, { label = kind } = {}) {
  kinds.set(kind, { factory, label })
}

export function deviceKinds() {
  return [...kinds.entries()].map(([kind, { label }]) => ({ kind, label }))
}

/** Build the device for `kind`, falling back to 'serial' for unknown kinds. */
export function createDevice(kind = 'serial') {
  const entry = kinds.get(kind) || kinds.get('serial')
  if (!entry) throw new Error('No device kinds registered')
  return entry.factory()
}

/** `?device=sim` picks a kind from the URL; anything else means real hardware. */
export function deviceKindFromUrl(href = globalThis.location?.href) {
  try {
    return new URL(href).searchParams.get('device') || 'serial'
  } catch {
    return 'serial'
  }
}

/** Names of the contract members `device` is missing. Empty means it fits. */
export function missingMembers(device) {
  const missing = []
  for (const name of REQUIRED_METHODS) if (typeof device?.[name] !== 'function') missing.push(name)
  for (const name of REQUIRED_PROPS) if (!(name in Object(device))) missing.push(name)
  if (typeof device?.addEventListener !== 'function') missing.push('addEventListener')
  return missing
}
