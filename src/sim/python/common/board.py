# CircuitPython's board: the simulated board's pins by name, and its buses.
import _sim
from microcontroller import Pin

for _name in _sim.pins():
    globals()[_name] = Pin(_name)

_i2c = None
_spi = None


def I2C():
    global _i2c
    if _i2c is None:
        import busio
        _i2c = busio.I2C(globals().get("SCL"), globals().get("SDA"))
    return _i2c


def SPI():
    global _spi
    if _spi is None:
        import busio
        _spi = busio.SPI(globals().get("SCK"), globals().get("MOSI"), globals().get("MISO"))
    return _spi
