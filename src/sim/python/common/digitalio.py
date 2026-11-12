# CircuitPython's digitalio, over the simulated board.
import _sim


class Direction:
    INPUT = 0
    OUTPUT = 1


class Pull:
    UP = 1
    DOWN = 2


class DriveMode:
    PUSH_PULL = 0
    OPEN_DRAIN = 1


class DigitalInOut:
    def __init__(self, pin):
        self._pin = pin.id
        self._dir = Direction.INPUT
        self._pull = None
        self._drive = DriveMode.PUSH_PULL
        _sim.dio_cfg(self._pin, 0, 0)

    def deinit(self):
        _sim.dio_cfg(self._pin, 0, 0)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.deinit()

    def switch_to_output(self, value=False, drive_mode=DriveMode.PUSH_PULL):
        self._dir = Direction.OUTPUT
        self._drive = drive_mode
        _sim.dio_cfg(self._pin, 1, 0)
        _sim.dio_set(self._pin, 1 if value else 0)

    def switch_to_input(self, pull=None):
        self._dir = Direction.INPUT
        self._pull = pull
        _sim.dio_cfg(self._pin, 0, pull or 0)

    @property
    def direction(self):
        return self._dir

    @direction.setter
    def direction(self, d):
        if d == Direction.OUTPUT:
            self.switch_to_output()
        else:
            self.switch_to_input(self._pull)

    @property
    def value(self):
        return bool(_sim.dio_get(self._pin))

    @value.setter
    def value(self, v):
        if self._dir != Direction.OUTPUT:
            raise AttributeError("Cannot set value when direction is input.")
        _sim.dio_set(self._pin, 1 if v else 0)

    @property
    def pull(self):
        return self._pull

    @pull.setter
    def pull(self, p):
        if self._dir == Direction.OUTPUT:
            raise AttributeError("Pull not used when direction is output.")
        self._pull = p
        _sim.dio_cfg(self._pin, 0, p or 0)

    @property
    def drive_mode(self):
        return self._drive

    @drive_mode.setter
    def drive_mode(self, m):
        self._drive = m
