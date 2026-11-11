// Programs a board on the boards page starts with: the radio, both ways.
// The tests run them too (tests/sim.mjs), so they stay working.

export const REMOTE_CODEX = `# A remote: press A or B, and every board on channel 7 hears it.
import radio
from codex import *
import time

radio.on()
radio.config(channel=7)
display.print("Remote, channel 7")
display.print("Press A or B")
while True:
    if buttons.was_pressed(BTN_A):
        radio.send("A")
        display.print("sent A")
    if buttons.was_pressed(BTN_B):
        radio.send("B")
        display.print("sent B")
    time.sleep(0.05)
`

export const LISTENER_CODEX = `# A listener: shows what it hears on channel 7, and how strong.
import radio
from codex import *
import time

radio.on()
radio.config(channel=7)
display.print("Listening, channel 7")
while True:
    heard = radio.receive_full()
    if heard:
        message, rssi, when = heard
        display.print("%s  %d dBm" % (message, rssi))
        if message == "A":
            pixels.fill(GREEN)
        elif message == "B":
            pixels.fill(RED)
    time.sleep(0.02)
`

export const LISTENER_CODEAIR = `# A listener: its lights show what it hears on channel 7.
import radio
from codeair import *
import time

radio.on()
radio.config(channel=7)
while True:
    message = radio.receive()
    if message == "A":
        pixels.fill(GREEN)
    elif message == "B":
        pixels.fill(RED)
    time.sleep(0.02)
`

export const LISTENER_CODEBOT = `# CodeBot has no radio. Try a CodeX or a CodeAIR here.
from botcore import *
leds.user(0b10101010)
`

// What a new board of each kind starts with: the first CodeX is the
// remote, the others listen.
export function exampleFor(kind, index) {
  if (kind === 'codex') return index === 0 ? REMOTE_CODEX : LISTENER_CODEX
  if (kind === 'codeair') return LISTENER_CODEAIR
  return LISTENER_CODEBOT
}
