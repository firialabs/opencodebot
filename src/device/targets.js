/**
 * What OpenCodeBot knows about each Firia Labs board.
 *
 * USB IDs match the CodeSpace device filters. Only boards that expose a
 * USB CDC serial port that Web Serial can open are listed as supported.
 */

export const TARGETS = {
  codebot: {
    id: 'codebot',
    name: 'CodeBot',
    fullName: 'CodeBot CB3',
    tagline: 'Rolling robot: motors, line sensors, proximity',
    icon: 'dev-codebot.svg',
    accent: '#4eb748',
    supported: true,
    usbFilter: { usbVendorId: 0x544d, usbProductId: 0xcb03 },
    // "FiriaLabs IoT Python 1a2b3c on 2024-05-01; ABCD CodeBot CB3 with ESP32S2"
    bootRegex: /FiriaLabs IoT Python (\S+) on ([\d-]+);.*CodeBot/i,
    docsUrl: 'https://docs.firialabs.com/codebot/',
  },

  codex: {
    id: 'codex',
    name: 'CodeX',
    fullName: 'CodeX handheld',
    tagline: 'Handheld: color screen, sound, buttons, sensors',
    icon: 'dev-codex.svg',
    accent: '#63c8f2',
    supported: true,
    usbFilter: { usbVendorId: 0x544d, usbProductId: 0xc0de },
    bootRegex: /FiriaLabs IoT Python (\S+) on ([\d-]+);.*CodeX/i,
    docsUrl: 'https://docs.firialabs.com/codex/',
  },

  codeair: {
    id: 'codeair',
    name: 'CodeAIR',
    fullName: 'CodeAIR drone',
    tagline: 'Flying drone: take off, fly, light up the sky',
    icon: 'dev-codeair.svg',
    accent: '#b49be0',
    supported: true,
    usbFilter: { usbVendorId: 0x544d, usbProductId: 0xca00 },
    bootRegex: /FiriaLabs Iot Python (\S+) on ([\d-]+);.*CodeAIR/i,
    docsUrl: 'https://docs.firialabs.com/codeair/',
  },

  // Recognised so we can explain ourselves, but not offered in the picker:
  // the original CodeBot speaks a USB protocol Web Serial cannot open.
  codebot_cb2: {
    id: 'codebot_cb2',
    name: 'CodeBot (CB2)',
    fullName: 'CodeBot CB2 (older model)',
    tagline: 'Older CodeBot — not supported by OpenCodeBot yet',
    icon: 'dev-codebot.svg',
    accent: '#a9abaf',
    supported: false,
    usbFilter: { usbVendorId: 0x0483, usbProductId: 0x5740 },
    bootRegex: /MicroPython (\S+) on ([\d-]+)/i,
    docsUrl: 'https://docs.firialabs.com/codebot/',
  },
}

/** Devices the user can pick and connect to, in menu order. */
export const SUPPORTED_TARGETS = Object.values(TARGETS).filter((t) => t.supported)

/** Filters handed to navigator.serial.requestPort(). */
export const ALL_USB_FILTERS = SUPPORTED_TARGETS.map((t) => t.usbFilter)

/** Map a SerialPort's USB product id back to a target id, or null. */
export function targetIdForPort(port) {
  if (!port || typeof port.getInfo !== 'function') return null
  const { usbVendorId, usbProductId } = port.getInfo()
  for (const target of Object.values(TARGETS)) {
    if (
      target.usbFilter.usbProductId === usbProductId &&
      target.usbFilter.usbVendorId === usbVendorId
    ) {
      return target.id
    }
  }
  return null
}

export function getTarget(id) {
  return TARGETS[id] || null
}
