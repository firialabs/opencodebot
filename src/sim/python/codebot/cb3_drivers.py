# The CB3's C module cb3_drivers, for the simulated board: the same names,
# over the simulator.
import _sim


def runtime_us():
    return _sim.runtime_us()


def enable_btn_isr():
    _sim.btn_was(0)
    _sim.btn_was(1)


def btn_was_pressed(num):
    return bool(_sim.btn_was(num))


class _CosDac:
    """The ESP32-S2's cosine generator, which drives the speaker."""

    def configure(self, *args):
        pass

    def set_pitch(self, freq):
        _sim.tone(int(freq))

    def off(self):
        _sim.tone(0)


cosdac = _CosDac()
