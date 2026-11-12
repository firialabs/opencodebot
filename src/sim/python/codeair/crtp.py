# CodeAIR's C module crtp, for the simulator: the UART link to the flight
# controller. Behind it is a simulated Crazyflie that speaks CRTP, so the
# device's own flight, flightdb and cflib modules run unchanged over it.
# Packets cross to the simulator as hex strings.
import _sim
import sys

_stdout = False


def init():
    _sim.crtp_init(1)


def deinit():
    _sim.crtp_init(0)


def send(port, channel, data):
    if isinstance(data, str):
        data = data.encode()
    _sim.crtp_send(port, channel, bytes(data).hex())


def receive():
    r = _sim.crtp_receive()
    if r is None:
        return None
    return (r[0], r[1], bytes.fromhex(r[2]))


def flush():
    _sim.crtp_flush()


def log_avail():
    return bool(_sim.crtp_log_avail())


def log_read():
    r = _sim.crtp_log_read()
    if r is None:
        return None
    return (r[0], r[1], bytes.fromhex(r[2]))


def console_read():
    return _sim.crtp_console_read()


def console_stdout(do_enable):
    _sim.crtp_console_stdout(1 if do_enable else 0)
