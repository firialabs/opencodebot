# CodeX's C tone generator, for the simulator: the simulator's synthesiser
# plays what each FuncSample is set to while it is connected to the speaker.
import _sim

FT_SINE = 0
FT_SQUARE = 1
FT_SAWTOOTH = 2
FT_TRIANGLE = 3
FT_RANDOM = 4
FT_ORGAN = 5
FT_SYNTH = 6


class FuncSample:
    def __init__(self, func_type=FT_SINE, sample_rate=16000, *args, **kwargs):
        self._id = _sim.voice_new(int(func_type))
        self.sample_rate = sample_rate

    def set_frequency(self, freq):
        _sim.voice_freq(self._id, float(freq), 0)

    def glide(self, freq, duration):
        _sim.voice_freq(self._id, float(freq), float(duration))

    def env_attack(self):
        _sim.voice_gate(self._id, 1)

    def env_release(self):
        _sim.voice_gate(self._id, 0)

    def set_function(self, func_type):
        _sim.voice_wave(self._id, int(func_type))

    def set_envelope(self, a, d, s, r):
        pass

    def set_modulator(self, *args):
        pass

    def set_synthbuf(self, buf):
        pass

    def deinit(self):
        _sim.voice_gate(self._id, 0)
