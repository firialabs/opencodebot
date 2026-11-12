# CircuitPython's busio, over the simulated board: I2C transactions go to the
# simulated chips on the bus, SPI writes to the simulated devices on the bus.
# Bytes cross to the simulator as hex strings.
import _sim


def _slice(buf, start, end):
    if end is None:
        end = len(buf)
    return buf[start:end]


class I2C:
    def __init__(self, scl, sda, *, frequency=100000, timeout=255):
        self._locked = False

    def try_lock(self):
        if self._locked:
            return False
        self._locked = True
        return True

    def unlock(self):
        self._locked = False

    def deinit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def scan(self):
        return list(_sim.i2c_scan())

    def writeto(self, address, buffer, *, start=0, end=None):
        if not _sim.i2c_write(address, bytes(_slice(buffer, start, end)).hex()):
            raise OSError(19)   # ENODEV: nothing answered at that address

    def readfrom_into(self, address, buffer, *, start=0, end=None):
        if end is None:
            end = len(buffer)
        data = _sim.i2c_read(address, end - start)
        if data is None:
            raise OSError(19)
        for i in range(end - start):
            buffer[start + i] = data[i]

    def writeto_then_readfrom(self, address, out_buffer, in_buffer, *,
                              out_start=0, out_end=None, in_start=0, in_end=None):
        self.writeto(address, out_buffer, start=out_start, end=out_end)
        self.readfrom_into(address, in_buffer, start=in_start, end=in_end)


class SPI:
    def __init__(self, clock, MOSI=None, MISO=None, half_duplex=False):
        self._clock = clock.id
        self._locked = False

    def try_lock(self):
        if self._locked:
            return False
        self._locked = True
        return True

    def unlock(self):
        self._locked = False

    def configure(self, *, baudrate=100000, polarity=0, phase=0, bits=8):
        pass

    def deinit(self):
        pass

    def write(self, buffer, *, start=0, end=None):
        _sim.spi_write(self._clock, bytes(_slice(buffer, start, end)).hex())

    def readinto(self, buffer, *, start=0, end=None, write_value=0):
        if end is None:
            end = len(buffer)
        for i in range(start, end):
            buffer[i] = 0

    def write_readinto(self, out_buffer, in_buffer, *, out_start=0, out_end=None, in_start=0, in_end=None):
        self.write(out_buffer, start=out_start, end=out_end)
        self.readinto(in_buffer, start=in_start, end=in_end)
