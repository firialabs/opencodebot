# CircuitPython's time, over MicroPython's: the simulator's clock is the
# world's simulated clock, so sleep() lets the world move on.
from utime import *
import utime as _t


def monotonic():
    return _t.ticks_us() / 1000000


def monotonic_ns():
    return _t.ticks_us() * 1000
