# CodeX's C module codex_drivers, for the simulator: the same names, over the
# simulated board.
import _sim


def hw_rev():
    return "C"


def io_exp_en_irq():
    _sim.btn_state(0x3F, 0x3F)


def io_exp_inp_state(clear_fell, clear_rose):
    """(current, fell, rose) for the buttons, as the button ISR latches them
    (bits low while pressed); then clears the latches named."""
    return tuple(_sim.btn_state(clear_fell, clear_rose))


def io_exp_outp_state(val):
    _sim.io_exp_out(val)


def pwm_preserve(pwm):
    pass


class _ES8311:
    """The audio codec chip."""

    def __init__(self):
        self._volume = 0

    def init(self, i2c, sample_freq):
        pass

    def get_volume(self):
        return self._volume

    def set_volume(self, v):
        self._volume = int(v)
        _sim.audio_volume(self._volume)

    def chip_id(self):
        return 0x83

    def read_reg(self, reg):
        return 0

    def write_reg(self, reg, val):
        pass

    def set_adc_dac(self, adc):
        pass


class _I2SIn:
    """The microphone: silence in the simulator."""

    def init(self, sample_freq):
        return True

    def readinto(self, buf, ms):
        import time
        time.sleep(ms / 1000)
        for i in range(len(buf)):
            buf[i] = 0

    def deinit(self):
        pass


es8311 = _ES8311()
i2sin = _I2SIn()
