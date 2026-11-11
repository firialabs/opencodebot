// Programs a board on the boards page can start from: the radio both ways,
// and a CodeX remote for CodeAIR's factory program (infrared, then radio).
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

export const XFLY_CODEAIR = `# CodeAIR's factory program: it waits to pair with a CodeX remote by
# infrared, then flies as the remote tells it by radio.
import xfly
xfly.run()
`

export const REMOTE_FOR_CODEAIR = `# A remote for a CodeAIR running its factory program (xfly).
# Pair: hold B until the CodeAIR flashes green.
# Fly: A takes off, B lands, U and D go forward and back, L and R turn.
import radio
from codex import *
import infrared
import json
import random
import time

ch = random.randrange(1, 13)
nid = random.randrange(255)

def send(op, args=()):
    radio.send(json.dumps((ch, nid, op, args)))

# 1. Pair by infrared: offer a channel and an ID until the CodeAIR echoes them.
display.print("Hold B to pair")
ir = infrared.Infrared(power)
paired = False
while not paired:
    if buttons.is_pressed(BTN_B):
        ir.send("P" + chr(ch) + chr(nid))
        ir.flush()
        time.sleep(0.1)
        if ir.receive() == "X" + chr(ch) + chr(nid):
            for _ in range(3):
                ir.send("ACK")
                time.sleep(0.1)
            paired = True
    else:
        time.sleep(0.05)
display.print("Paired: CH%d ID%d" % (ch, nid), color=GREEN)

# 2. Fly by radio: tell it what to do every 0.1 s (it lands if we stop).
radio.on()
radio.config(channel=ch)
display.print("A: take off  B: land")
display.print("U/D: forward, back")
display.print("L/R: turn")
buttons.was_pressed()
while True:
    if buttons.was_pressed(BTN_A):
        send("fly", [True])
    if buttons.was_pressed(BTN_B):
        send("fly", [False])
    forward = 30 * (buttons.is_pressed(BTN_U) - buttons.is_pressed(BTN_D))
    turn = 60 * (buttons.is_pressed(BTN_R) - buttons.is_pressed(BTN_L))
    send("d1", [forward, 0, turn])
    while radio.receive():
        pass
    time.sleep(0.1)
`

export const LISTENER_CODEBOT = `# CodeBot has no radio. Try a CodeX or a CodeAIR here.
from botcore import *
leds.user(0b10101010)
`

// Each kind's examples: [id, name, program].
export const EXAMPLES = {
  codex: [
    ['remote', 'Radio remote (A or B)', REMOTE_CODEX],
    ['listener', 'Radio listener', LISTENER_CODEX],
    ['codeair-remote', 'Remote for a CodeAIR', REMOTE_FOR_CODEAIR],
  ],
  codeair: [
    ['listener', 'Radio listener', LISTENER_CODEAIR],
    ['xfly', 'Factory program (pairs with a CodeX remote)', XFLY_CODEAIR],
  ],
  codebot: [['lights', 'Lights', LISTENER_CODEBOT]],
}

export function example(kind, id) {
  return EXAMPLES[kind]?.find(([i]) => i === id)?.[2] ?? null
}

// What a new board of each kind starts with: the first CodeX is the
// remote, the others listen.
export function exampleFor(kind, index) {
  if (kind === 'codex') return index === 0 ? REMOTE_CODEX : LISTENER_CODEX
  if (kind === 'codeair') return LISTENER_CODEAIR
  return LISTENER_CODEBOT
}
