# CircuitPython's analogio, over the simulated board: readings are 16-bit.
import _sim


class AnalogIn:
    def __init__(self, pin):
        self._pin = pin.id
        self.reference_voltage = 3.3

    @property
    def value(self):
        return _sim.adc(self._pin)

    def deinit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class AnalogOut:
    def __init__(self, pin):
        self._pin = pin.id
        self._value = 0

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = v
        _sim.dac(self._pin, v)

    def deinit(self):
        pass
