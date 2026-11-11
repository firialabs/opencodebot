# CodeX's radio, for the simulator: messages go to the other simulated
# devices in this page on the same channel (none yet: nothing is heard).
import _sim

_on = False
_channel = 0


def on():
    global _on
    _on = True


def off():
    global _on
    _on = False


def config(*, channel=0):
    global _channel
    if not 0 <= channel <= 13:
        raise ValueError("channel must be in range 0-13")
    _channel = channel


def send(message):
    if _on:
        _sim.radio_send(_channel, str(message))


def receive():
    full = receive_full()
    return full[0] if full else None


def receive_full():
    if not _on:
        return None
    m = _sim.radio_receive(_channel)
    return None if m is None else (m[0], m[1], m[2])
