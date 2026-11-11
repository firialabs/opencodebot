"""CodeBot CB3 hardware, simulated.

The same names and behaviour as the CB3's botcore (docs.firialabs.com), over
the simulator's world: `_sim` is the world's side of each part.
"""
import _sim

LEFT = 0
RIGHT = 1


def _check_num(num, count, what):
    if not isinstance(num, int) or num < 0 or num >= count:
        raise ValueError("{} must be in range 0-{}.".format(what, count - 1))


def _bits(b, count):
    """An int, or a sequence of bools (bit 0 first), as an int of count bits."""
    if isinstance(b, int):
        if b < 0 or b >= (1 << count):
            raise ValueError("LED binary value must be in range 0-{}.".format((1 << count) - 1))
        return b
    if isinstance(b, (list, tuple)):
        if len(b) > count:
            raise ValueError("LED has max {} elements, {} given".format(count, len(b)))
        v = 0
        for i, on in enumerate(b):
            if on:
                v |= 1 << i
        return v
    raise ValueError("LED requires int or sequence. Got {} instead.".format(type(b)))


class System:
    """General system-level functions"""

    def pwr_is_usb(self):
        return bool(_sim.pwr_is_usb())

    def pwr_volts(self):
        return _sim.pwr_volts()

    def temp_C(self):
        return _sim.temp_c()

    def temp_F(self):
        return _sim.temp_c() * 9 / 5 + 32


class Expansion:
    """The expansion port: nothing is plugged into a simulated CodeBot."""

    def make_pwm(self, pin, duty_cycle=0, frequency=50):
        raise NotImplementedError("The expansion port is not simulated yet")

    def release_pwm(self, pwm):
        pass

    def set_servo(self, pwm, position_pct):
        raise NotImplementedError("The expansion port is not simulated yet")


class Speaker:
    """Control the Speaker"""

    def pitch(self, freq, duty=50):
        if freq < 0:
            raise ValueError("freq must be in Hertz (> 0 Hz)")
        _sim.tone(freq)

    def off(self):
        _sim.tone(0)


class Buttons:
    """Pushbutton switches BTN-0 and BTN-1."""

    def was_pressed(self, num=None):
        if num is None:
            return (bool(_sim.btn_was(0)), bool(_sim.btn_was(1)))
        _check_num(num, 2, "Button num")
        return bool(_sim.btn_was(num))

    def is_pressed(self, num=None):
        if num is None:
            return (bool(_sim.btn_is(0)), bool(_sim.btn_is(1)))
        _check_num(num, 2, "Button num")
        return bool(_sim.btn_is(num))


class CB_LEDs:
    """All the LEDs on CodeBot."""

    def user(self, b):
        _sim.led_set("user", _bits(b, 8))

    def user_num(self, num, val):
        if not (isinstance(num, int) and 0 <= num < 8):
            raise ValueError("User LED must be in range 0-7.")
        _sim.led_bit("user", num, bool(val))

    def ls(self, b):
        _sim.led_set("ls", _bits(b, 5))

    def ls_num(self, num, val):
        if not (isinstance(num, int) and 0 <= num < 5):
            raise ValueError("LS LED must be in range 0-4.")
        _sim.led_bit("ls", num, bool(val))

    def ls_emit(self, ls_num, pwr):
        _check_num(ls_num, 5, "Line Sensor num")

    def pwr(self, is_on):
        _sim.led_set("pwr", 1 if is_on else 0)

    def usb(self, is_on):
        _sim.led_set("usb", 1 if is_on else 0)

    def enc_emit(self, b):
        pass

    def prox(self, b):
        _sim.led_set("prox", _bits(b, 2))

    def prox_num(self, num, val):
        if not (isinstance(num, int) and 0 <= num < 2):
            raise ValueError("Prox LED must be 0 or 1.")
        _sim.led_bit("prox", num, bool(val))

    def prox_emit(self, pwr):
        pass


class Proximity:
    """The proximity sensors"""

    def detect(self, power=1, sens=100):
        if not isinstance(power, int) or power < 0 or power > 8:
            raise ValueError("Power must be between 0 and 8")
        if not isinstance(sens, int) or sens < 0 or sens > 100:
            raise ValueError("Sensitivity must be between 0 and 100")
        return (bool(_sim.prox_detect(0, power, sens)), bool(_sim.prox_detect(1, power, sens)))

    def range(self, samples=4, power=1, rng_low=0, rng_high=100):
        if samples == 1:
            return self.detect(power, rng_low)
        return (_sim.prox_range(0, samples, power, rng_low, rng_high),
                _sim.prox_range(1, samples, power, rng_low, rng_high))

    def read(self, num):
        _check_num(num, 2, "Proximity Sensor num")
        return _sim.prox_read(num)


class LineSensors:
    """The line sensors."""

    def __init__(self):
        self.thresh = 2000
        self.reflective_line = False

    def check(self, thresh=1000, is_reflective=False):
        vals = self.read_all()
        if thresh == 0:
            return vals
        if isinstance(is_reflective, int) and not isinstance(is_reflective, bool):
            upper = is_reflective
            return tuple(-1 if v < thresh else (1 if v > upper else 0) for v in vals)
        if is_reflective:
            return tuple(v < thresh for v in vals)
        return tuple(v > thresh for v in vals)

    def calibrate(self, threshold, is_reflective_line):
        self.thresh = threshold
        self.reflective_line = is_reflective_line

    def read(self, num):
        _check_num(num, 5, "Line Sensor num")
        return _sim.ls_read(num)

    def read_all(self):
        return tuple(_sim.ls_read(n) for n in range(5))

    def is_line(self, num):
        reflects = self.read(num) < self.thresh
        return reflects if self.reflective_line else not reflects


class Encoders:
    """The wheel encoders, read as analog values."""

    def __init__(self):
        self.thresh = 2000

    def read(self, num):
        _check_num(num, 2, "Wheel encoder num")
        return _sim.enc_read(num)

    def is_slot(self, num):
        return self.read(num) > self.thresh


class Motors:
    """The motors"""

    def enable(self, do_enable):
        _sim.motors_enable(bool(do_enable))

    def run(self, num, pwr):
        if not isinstance(num, int) or num < 0 or num > 1:
            raise ValueError("Motor num must be 0 (LEFT) or 1 (RIGHT).")
        if pwr < -100 or pwr > 100:
            raise ValueError("Motor power must be in range -100 to +100")
        _sim.motors_run(num, pwr)


class KXTJ3:
    """The accelerometer"""

    def read(self):
        return tuple(_sim.accel_read())

    def dump_axes(self):
        x, y, z = self.read()
        print("X={}, Y={}, Z={}".format(x, y, z))


system = System()
leds = CB_LEDs()
exp = Expansion()
spkr = Speaker()
buttons = Buttons()
prox = Proximity()
ls = LineSensors()
enc = Encoders()
motors = Motors()
accel = KXTJ3()
