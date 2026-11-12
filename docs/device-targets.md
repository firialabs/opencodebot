# Device targets

The app runs programs on a **DeviceTarget**. A board on a USB cable is one kind; a
simulator is another. The UI (`src/ui/app.js`) only talks to this interface, so a new
kind plugs in without changing the UI.

Code: `src/device/device-target.js` (interface, registry, contract check).

| Kind       | File                              | How to pick it         |
| ---------- | --------------------------------- | ---------------------- |
| `serial`   | `src/device/device-manager.js`    | default                |
| `loopback` | `src/device/loopback-device.js`   | `?device=loopback`     |
| `sim`      | `src/sim/sim-device.js`           | `?device=sim`, or Simulate |

The app pairs the page's kind with the simulator (`src/sim/device-switch.js`, itself a
DeviceTarget): the Simulate button switches to it and back, and a board plugged in while
simulating takes over. `?device=sim` opens the page in the simulator.

## Adding a kind

1. Write a class that extends `EventTarget` and has the members below.
2. At the bottom of its module: `registerDeviceKind('sim', () => new SimDevice(), { label: 'Simulator' })`.
3. Import that module once in `src/ui/app.js`, next to the other device imports.
4. Open the app with `?device=sim`.

`loopback-device.js` is the smallest complete example (about 100 lines). Start there.

## The interface

### Properties

| Name          | Type                                   | Meaning |
| ------------- | -------------------------------------- | ------- |
| `kind`        | string                                 | The registered kind, such as `'serial'` or `'sim'`. |
| `supported`   | boolean                                | False if this browser cannot use this kind at all. The UI then disables Connect. |
| `isConnected` | boolean                                | True between a successful `connect()` and a disconnect. |
| `state`       | `'offline' \| 'connecting' \| 'ready' \| 'loading' \| 'running'` | Current state. Always change it through a `state` event. |
| `targetId`    | `'codebot' \| 'codex' \| 'codeair' \| null` | Which board this is (device identity). Keys of `TARGETS` in `targets.js`. |
| `firmware`    | `{ version, date } \| null`            | Optional, shown in the terminal when known. |

### Methods

| Method | Returns | Must do |
| ------ | ------- | ------- |
| `connect()` | `Promise<boolean>` | Called straight from a click, so it may open a browser picker. Set `targetId`, dispatch `device`, then reach `ready` (or `running` if a program is already going). |
| `disconnect()` | `Promise<void>` | Dispatch `device` with `targetId: null` and go `offline`. |
| `autoConnect()` | `Promise<boolean>` | Optional. Reconnect without a click if possible (serial: an already paired board). |
| `run(source)` | `Promise<boolean>` | `source` is a complete CircuitPython program. Store it as `main.py`, start it, go `loading` then `running`. When it ends on its own, go `ready`. |
| `stop()` | `Promise<boolean>` | Stop the program, leave nothing moving, go `ready`. Accepts `{ quiet }` (suppress notices). |
| `sendRaw(data)` | void | REPL bytes typed in the terminal (string or `Uint8Array`). `\x03` (Ctrl-C) means interrupt. |
| `writeFile(name, contents)` | `Promise<boolean>` | Save a file without running it. |

### Events

All are `CustomEvent`s with the payload in `detail`.

| Event | `detail` | When |
| ----- | -------- | ---- |
| `state` | `{ state, message }` | Every state change. `message` is shown in the status bar, so keep it short and friendly. |
| `device` | `{ targetId, target, firmware? }` | Identity known or changed. `target` is `getTarget(targetId)`. |
| `data` | `Uint8Array` | Bytes for the terminal (REPL output, `print`). |
| `progress` | number from 0 to 1 | While a program or file is being sent. |
| `notice` | `{ kind: 'info'\|'warn'\|'error', title, detail }` | Something to tell the student in a toast. |
| `program-error` | `{ name, message, line }` | The program raised an exception. `line` is the Python line number or null. |

## Notes for the simulator

- The program you receive is exactly what a real board gets: it starts with
  `from botcore import *` (CodeBot), `from codex import *` or `from codeair import *`.
  The device APIs it calls are the ones the blocks generate (see `src/blocks/*.js`).
- Send `print` output as `data` bytes, with `\r\n` line endings, so the terminal shows it.
- If the simulator has its own REPL, wire it to `sendRaw` and `data`. If not, echo like
  `loopback-device.js` does.
- `tests/device.mjs` drives Connect, Run and Stop against `?device=loopback` and checks
  the contract with `missingMembers()`. Copy it for `?device=sim`.
- Privacy: a simulator must run entirely in the browser. Nothing leaves the page.

## Not covered here

Web Serial is the only real-hardware kind in this repository today. A WebUSB kind would
be one more module registered the same way.
