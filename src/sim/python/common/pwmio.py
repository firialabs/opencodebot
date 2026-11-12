# CircuitPython's pwmio, over the simulated board.
import _sim


class PWMOut:
    def __init__(self, pin, *, duty_cycle=0, frequency=500, variable_frequency=False):
        self._pin = pin.id
        self._duty = duty_cycle
        self._freq = frequency
        self._variable = variable_frequency
        _sim.pwm(self._pin, self._duty, self._freq)

    def deinit(self):
        _sim.pwm(self._pin, 0, 0)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.deinit()

    @property
    def duty_cycle(self):
        return self._duty

    @duty_cycle.setter
    def duty_cycle(self, d):
        if not 0 <= d <= 65535:
            raise ValueError("duty_cycle must be 0-65535")
        self._duty = int(d)
        _sim.pwm(self._pin, self._duty, self._freq)

    @property
    def frequency(self):
        return self._freq

    @frequency.setter
    def frequency(self, f):
        if not self._variable:
            raise AttributeError("PWM frequency not writable when variable_frequency is False.")
        self._freq = int(f)
        _sim.pwm(self._pin, self._duty, self._freq)
