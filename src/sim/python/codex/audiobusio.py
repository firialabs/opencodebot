# CircuitPython's audiobusio for the simulated CodeX: what plays on I2SOut
# is what the speaker sounds.
import _sim


class I2SOut:
    def __init__(self, bit_clock, word_select, data, *, left_justified=False):
        self._source = None

    def play(self, sample, *, loop=False):
        self._source = sample
        _sim.i2s_play(_sim_id(sample), 1 if loop else 0)

    def stop(self):
        self._source = None
        _sim.i2s_play(-1, 0)

    @property
    def playing(self):
        return bool(_sim.i2s_playing())

    def pause(self):
        pass

    def resume(self):
        pass

    def deinit(self):
        self.stop()


def _sim_id(sample):
    return getattr(sample, "_id", -2)    # -2: a sound the simulator does not synthesise
