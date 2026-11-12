# The radio of CodeX and CodeAIR (a C module on both), for the simulator:
# messages go to the other simulated devices on the same channel, in this
# page or another tab of the same browser (src/sim/world/radio.js).
import _sim

_on = False
_channel = 0


def on():
    global _on
    _on = True
    _sim.radio_set(_on, _channel)


def off():
    global _on
    _on = False
    _sim.radio_set(_on, _channel)


def config(*, channel=0):
    global _channel
    if not 0 <= channel <= 13:
        raise ValueError("channel must be in range 0-13")
    _channel = channel
    _sim.radio_set(_on, _channel)


def send(message):
    if _on:
        _sim.radio_send(str(message))


def receive():
    full = receive_full()
    return full[0] if full else None


def receive_full():
    if not _on:
        return None
    m = _sim.radio_receive()
    return None if m is None else (m[0], m[1], m[2])
