# CircuitPython's microcontroller, over the simulated board.
import _sim
import time


class Pin:
    def __init__(self, name):
        self.id = name

    def __repr__(self):
        return "board." + self.id

    def __eq__(self, other):
        return isinstance(other, Pin) and other.id == self.id

    def __hash__(self):
        return hash(self.id)


class _Processor:
    @property
    def temperature(self):
        return _sim.temp_c()

    @property
    def frequency(self):
        return 240000000

    @property
    def voltage(self):
        return 3.3


cpu = _Processor()


def delay_us(us):
    time.sleep_us(int(us))


def reset():
    raise SystemExit("reset")


def on_next_reset(run_mode):
    pass
