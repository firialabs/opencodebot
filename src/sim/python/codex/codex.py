"""Core low-level module for CodeX

The *codex* module gives you direct access to all the hardware on the CodeX.
    * power = `Power`
    * buttons = `Buttons`
    * leds = `LEDs`
    * pixels = `NEOPixels`
    * display = `canvas.Canvas`
    * audio = `codec.Codec`
    * accel = `LIS2DH` or `KXTJ3`
    * light = `AmbientLight`
    * exp = `Expansion`
    * tft = `tft.TFT`

"""

# Circuitpython modules
import board
import digitalio
import neopixel
import analogio
import pwmio
import time

# Firia modules
from codex_drivers import hw_rev
if hasattr(hw_rev, '__module__'):
    hw_rev = lambda : 'C'   # Patch for autodoc

if hw_rev() < 'C':
    from lis2dh import LIS2DH as Accelerometer
else:
    from kxtj3 import KXTJ3 as Accelerometer

import ltr303als01  # ambient light
import ioexpander  # LEDs and buttons
import codec  # audio
from codex_drivers import io_exp_inp_state   # Fast button states captured from ISR
from codex_drivers import pwm_preserve
import tft

import gallery as pics
from colors import *

# Buttons (up,right,down,left,A,B)
BTN_U = 0  #: UP
BTN_R = 1  #: RIGHT
BTN_D = 2  #: DOWN
BTN_L = 3  #: LEFT
BTN_A = 4  #: A
BTN_B = 5  #: B

# LEDs (A,B)
LED_A = 5 #: LED A
LED_B = 4 #: LED B

class Power:
    """Access to the CodeX power control and power monitoring."""

    VBATT_SENS = board.IO2
    IBATT_SENS = board.IO1

    ADC_FULL_SCALE = 65535
    ADC_SAMPLES_TO_AVERAGE = 100

    # V/I sensor parameters
    MA_PER_VOLT = 100  # Factor based on current shunt + amp

    VOLTAGE_RATIO = (59 + 107) / 59

    def __init__(self, io_expander):
        self._io_expander = io_expander
        self._periph_vcc = digitalio.DigitalInOut(board.IO37)
        self._periph_vcc.pull = None
        # Analog pins for voltage and currentt
        self._voltage_adc = analogio.AnalogIn(Power.VBATT_SENS)
        self._current_adc = analogio.AnalogIn(Power.IBATT_SENS)

    def get_battery_voltage(self):
        """Measure the power supply voltage (battery or USB).

        Returns:
            float : Power supply voltage
        """
        org = self.is_batt_meas_enable()
        self.enable_batt_meas(True)
        adc_counts_total = 0
        count = Power.ADC_SAMPLES_TO_AVERAGE
        while count > 0:
            adc_counts = self._voltage_adc.value
            adc_counts_total += adc_counts
            count -= 1
        adc_counts = adc_counts_total / Power.ADC_SAMPLES_TO_AVERAGE
        voltage = (adc_counts * self._voltage_adc.reference_voltage) / \
            Power.ADC_FULL_SCALE
        self.enable_batt_meas(org)
        return voltage * Power.VOLTAGE_RATIO

    def get_battery_current(self):
        """Measure the power supply current consumption (battery or USB).

        Returns:
            float : Current consumption in milliamps
        """
        org = self.is_batt_meas_enable()
        self.enable_batt_meas(True)
        adc_counts_total = 0
        count = Power.ADC_SAMPLES_TO_AVERAGE
        while count > 0:
            adc_counts = self._current_adc.value
            adc_counts_total += adc_counts
            count -= 1
        adc_counts = adc_counts_total / Power.ADC_SAMPLES_TO_AVERAGE
        voltage = (adc_counts * self._current_adc.reference_voltage) / \
            Power.ADC_FULL_SCALE
        # Per the schematic
        current_in_ma = voltage * Power.MA_PER_VOLT
        self.enable_batt_meas(org)
        return current_in_ma

    def is_usb(self):
        """Are we powered by USB or Battery?

        Returns:
            bool : True (USB) or False (Battery)
        """
        if hw_rev() < 'C':
            org = self.is_batt_meas_enable()
            self.enable_batt_meas(True)
            ret = self._io_expander.get_input(0)
            self.enable_batt_meas(org)
        else:
            ret = not self._io_expander.get_input(0)

        return ret

    def is_batt_meas_enable(self):
        """Is the battery measurement ability enabled?

        Returns:
            bool : True if the measurement ability is enabled
        """
        return bool(self._io_expander.get_outputs() & 2)

    def enable_batt_meas(self, do_enable):
        """Enable the battery measurement ability.

        Args:
            do_enable: True to enable measurement or False to disable
        """
        bits = self._io_expander.get_outputs()
        bits = (bits | 2) if do_enable else (bits & ~2)
        self._io_expander.set_outputs(bits)

    def is_periph_vcc_enable(self):
        """Is the power enabled for peripheral devices?

        Returns:
           bool : True if power is enabled for peripheral devices
        """
        return self._periph_vcc.value

    def enable_periph_vcc(self, do_enable, guarded=True):
        """Enable power (+5V) for peripheral devices.

        Args:
            do_enable : True to enable power for peripheral devices
            guarded : Protect CPU power from dipping due to peripheral surges.
        """
        if guarded:
            # The 3.3V regulator can override our pullup and shut down peripheral power if needed
            self._periph_vcc.switch_to_input(pull=digitalio.Pull.UP if do_enable else None)
        else:
            self._periph_vcc.switch_to_output(value=do_enable)


class LEDs:
    """Access to the six LEDs on the CodeX."""

    def __init__(self, io_expander):
        self._io_expander = io_expander

    def get(self, num=None):
        """Get the current states of an LED or all LEDs if None is specified.

        Returns:
            bool  : value of given LED num, OR
            tuple : six bools -- one for each LED
        """
        bits = self._io_expander.get_outputs()
        bits >>= 2

        if num is None:
            ret = tuple(bool(bits & (1 << i)) for i in range(6))
        elif type(num) == int and 0 <= num <= 5:
            ret = bool(bits & (1 << num))
        else:
            raise ValueError('LED number must be 0-5')

        return ret

    def set(self, num, value=None):
        """Set the state of a single LED

        Args:
            num (int) : led number (0-5)
            value (bool) : True (on) or False (off)
        """
        if value is None and isinstance(num, int):
            for i in range(6):
                self.set(i, num & (1 << i))
        elif value is None and (isinstance(num, list) or isinstance(num, tuple)):
            if len(num) == 4 or len(num) == 6:
                for i in range(len(num)):
                    self.set(i, num[i])
            else:
                raise ValueError('You must set all LED values at once.')
        elif isinstance(num, int):
            if num < 0 and num > 5:
                raise ValueError("LED num must have a value between 0 and 5.")
            bits = self._io_expander.get_outputs()
            num += 2  # LEDs start at bit 2
            if value:
                bits |= (1 << num)
            else:
                bits &= ~(1 << num)
            self._io_expander.set_outputs(bits)
        else:
            raise ValueError('Incorrect type supplied to set()')

class NEOPixels:
    """Access to the four CodeX neopixels."""

    DEFAULT_BRIGHTNESS = 10 # percent

    def __init__(self):
        self._strip = neopixel.NeoPixel(board.IO33, 4, pixel_order='GRB')
        self.off()

    def set(self, num, value=WHITE, brightness=DEFAULT_BRIGHTNESS):
        """Set the RGB state of the Codex Neopixels.

        Args:
            num (int/list/tuple) : Pixel number (0,1,2,3, or a list of 4 values to set all pixels)
            value (tuple): A tuple of three values for RGB like (10,88,102)
            brightness (int): Value between 0 - 100 to scale the brightness of the RGBs
        """
        power.enable_periph_vcc(True)
        if isinstance(num, list) or isinstance(num, tuple):
            if len(num) != 4:
                raise ValueError('Must provide exactly 4 pixels')
            for i in range(4):
                self.set(i, num[i], brightness)
        elif isinstance(num, int):
            if isinstance(value, list) or isinstance(value, tuple):
                rgb = scale_rgb(value, brightness)
                self._strip[num] = rgb
            else:
                raise TypeError('Invalid color value - must be tuple or list')
        else:
            raise TypeError('pixel num must be int, list, or tuple')

    def off(self):
        """Turn off all Neopixels."""
        self._strip.fill((0, 0, 0))

    def fill(self, value, brightness=DEFAULT_BRIGHTNESS):
        """Set all NeoPixels to a single color.

        Args:
            value (tuple): A tuple of three values for RGB like (10,88,102)
        """
        power.enable_periph_vcc(True)
        if isinstance(value, list) or isinstance(value, tuple):
            rgb = scale_rgb(value, brightness)
            self._strip.fill(rgb)
        else:
            raise TypeError('Invalid color value - must be tuple or list')

    def get(self, num=None):
        """Get current RGB value of Codex NeoPixels. This will be the value after brightness was applied.

        Args:
            num (int/None): A number from 0 - 3 will return a single value, None will return tuple of all 4 values.

        Returns:
            value (tuple/tuple of 4 tuples)
        """
        if num is None:
            return tuple([self._strip[0], self._strip[1], self._strip[2], self._strip[3]])
        elif num >= 0 and num < 4:
            return self._strip[num]
        else:
            raise ValueError('num must be an int from 0-4 or None')

class Buttons:
    """Access to pushbutton switches BTN-0 through BTN-5.
       Buttons can be referenced by `int` value 0-5, or by symbolic names:
       `BTN_U` , `BTN_R`, `BTN_D`, `BTN_L`, `BTN_A`, `BTN_B`

    """

    def __init__(self, io_expander):
        self._io_expander = io_expander

    def __str__(self):
        return "{}".format(self.is_pressed())

    def was_pressed(self, num=None):
        """Return True if specified button was pressed since last call of this function.
        Default with num=None, returns tuple of status for all buttons since last call.

        Args:
          num (int/None): 0-5 or None

        Returns:
          value (bool/tuple): bool if num was an int else a tuple of all values
        """
        if num is None:
            mask = 0x3F
            cur, fell, rose = io_exp_inp_state(mask, 0)
            was = fell & mask
            return tuple(bool(was & (1 << i)) for i in range(6))
        elif num >= 0 and num <= 5:
            mask = 1 << num
            cur, fell, rose = io_exp_inp_state(mask, 0)
            return bool(fell & mask)
        else:
            raise ValueError("Button num must be 0 - 5 or None")

    def is_pressed(self, num=None):
        """Return True if specified button is pressed, or tuple of status for all buttons
        if num=None.

        Args:
            num (int/None): 0-5 or None

        Returns:
          value (bool/tuple): bool if num was an int else a tuple of all values
        """
        val = io_exp_inp_state(0, 0)[0] & 0x3F
        if num is None:
            return tuple(not val & (1 << i) for i in range(6))
        elif num >= 0 and num <= 5:
            return not val & (1 << num)
        else:
            raise ValueError("Button num must be 0 - 5 or None")


class AmbientLight:
    """Access to the CodeX ambient light sensor.

    This device has two light sensors. One reads only infrared light. The other
    reads infrared light and visibile light at the same time.
    """

    def __init__(self, i2c, power):
        self._sns = ltr303als01.LTR303ALS01(i2c)
        self._power = power
        self._sns.go_active()
        self._active = True
        self._cur_gain = None
        self.set_gain(100)  # Set max gain

    def _get_chip_id(self):
        return self._sns.chip_detected

    def read_channels(self):
        """Read both light sensor ADC values. Value depends on current gain setting.

        Returns:
            tuple(int) : The values from both sensors as (ir, ir+visible)
        """
        ret = self._sns.read_channels()
        return ret

    def read_ir(self):
        """Read the IR light level ADC value. Value depends on current gain setting.

        Returns:
            int : ir light
        """
        return self.read_channels()[0]

    def read(self):
        """Read the infrared plus visible light level ADC value. Value depends on current gain setting.

        Returns:
            int : visible + infrared
        """
        ret = self._sns.read_channels()
        return ret[1]  # Visible + IR (Ch0 is just IR)

    def read_lux(self, max_lux=500):
        """Read the infrared plus visible light level in LUX.

        Args:
            max_lux (float) : Maximum range of LUX to measure.

        Returns:
            float : lux value
        """
        self.set_gain(max_lux)
        ret = self._sns.read_channels()
        return ret[1] / self.gain_factor

    def set_gain(self, max_lux):
        """Set the gain (sensitivity) of the sensor.

        Args:
            max_lux (float) : Maximum range of LUX to measure.
        """
        gain = ltr303als01.ALS_GAIN_96X
        self.gain_factor = 96
        if max_lux > 32768:
            gain = ltr303als01.ALS_GAIN_1X
            self.gain_factor = 1
        elif max_lux > 16384:
            gain = ltr303als01.ALS_GAIN_2X
            self.gain_factor = 2
        elif max_lux > 8192:
            gain = ltr303als01.ALS_GAIN_4X
            self.gain_factor = 4
        elif max_lux > 1365:
            gain = ltr303als01.ALS_GAIN_8X
            self.gain_factor = 8
        elif max_lux > 600:
            gain = ltr303als01.ALS_GAIN_48X
            self.gain_factor = 48

        if gain != self._cur_gain:
            self._cur_gain = gain
            self._sns.set_gain(gain)
            time.sleep(0.5)  # Await gain change


class Expansion:
    """Access to Expansion connectors and Peripheral ports.

    This class provides functions for basic usage of the available expansion pins.

    For advanced users, feel free to use CircuitPython hardware interface libraries like
    `digitalio`, `analogio`, `pwmio`, and `busio` directly with these GPIO pins as well.

    """

    # Expansion Connectors
    GPIO0 = board.IO15  #:
    GPIO1 = board.IO16  #:
    GPIO2 = board.IO42  #:
    GPIO3 = board.IO40  #:
    GPIO4 = board.IO39  #: Expansion Connectors

    # Peripheral Connectors
    PORT0 = board.IO13  #:
    PORT1 = board.IO14  #:
    PORT2 = board.IO10  #:
    PORT3 = board.IO11  #: Peripheral Connectors
    # NOTE: Expansion functions will only work with the above pins.

    def __init__(self):
        self._cache = {
            Expansion.GPIO0: None,
            Expansion.GPIO1: None,
            Expansion.GPIO2: None,
            Expansion.GPIO3: None,
            Expansion.GPIO4: None,
            Expansion.PORT0: None,
            Expansion.PORT1: None,
            Expansion.PORT2: None,
            Expansion.PORT3: None,
        }

    def analog_in(self, port):
        """Connect a analog input peripheral to the specified port.

        You can use this method to set up input devices like potentiometers,
        analog temperature sensors, and light sensors.

        The peripheral will use a 16-bit Analog-to-Digital Converter (ADC).
        Accessing the :py:attr:`~analogio.AnalogIn.value` attribute of the returned object
        returns the latest reading as an integer.
        Analog readings are in the range of 0-65535 (inclusive),
        where 0 is a reading of 0 mV and 65535 is a reading of approximately 3300 mV.

        .. note::
            Analog devices saturate the CodeX's Analog to Digital Converter (ADC)
            at 2.5V, half of the 5V output on the Peripheral connector ports.
            If full analog range is desired, remember to connect your CodeX Peripheral Divider!

        Args:
            port (microcontroller.Pin): Expansion port to configure.

        Returns:
            analogio.AnalogIn : A peripheral object representing the analog input.
        """
        # Is port allowed, and is it being used already?
        if port not in self._cache:
            raise ValueError("Port not allowed")

        cached = self._cache[port]

        if isinstance(cached, analogio.AnalogIn):
            return cached

        if cached is not None:
            cached.deinit()

        # Sensors need +5V power
        power.enable_periph_vcc(True)

        ret = analogio.AnalogIn(port)
        self._cache[port] = ret
        return self._cache[port]

    def digital_in(self, port, pull=None):
        """Connect a digital input peripheral to the specified port.

        You can use this method to set up digital input devices like buttons and switches.

        Accessing the :py:attr:`~digitalio.DigitalInOut.value` attribute of the returned object
        returns the latest reading as a bool, where True is high and False is low.
        Note that for most switches and buttons, the pressed state will return False.

        Args:
            port (microcontroller.Pin): Expansion port to configure.
            pull (bool): Default output value when not being used.

        Returns:
            digitalio.DigitalInOut : A peripheral object representing the digital input.
        """
        # Is pin allowed, and is it being used already?
        if port not in self._cache:
            raise ValueError("Port not allowed")

        cached = self._cache[port]

        if isinstance(cached, digitalio.DigitalInOut):
            if cached.direction is digitalio.direction.INPUT:
                return cached
            else:
                cached.switch_to_input(pull=pull)
                return cached

        if cached is not None:
            cached.deinit()

        # Sensors need +5V power
        power.enable_periph_vcc(True)

        ret = digitalio.DigitalInOut(port)
        ret.switch_to_input(pull=pull)
        self._cache[port] = ret
        return self._cache[port]

    def digital_out(self, port, value=False):
        """Connect a digital output peripheral to the specified port.

        You can use this method to set up digital output devices like LEDs without brightness control.

        Setting the :py:attr:`~digitalio.DigitalInOut.value` attribute of the returned object
        sets the port's output level, where True is high and False is low.

        Args:
            port (microcontroller.Pin): Expansion port to configure.
            value (bool): Initial output value.

        Returns:
            digitalio.DigitalInOut : A peripheral object representing the digital output.
        """
        # Is pin allowed, and is it being used already?
        if port not in self._cache:
            raise ValueError("Port not allowed")

        cached = self._cache[port]

        if isinstance(cached, digitalio.DigitalInOut):
            if cached.direction is digitalio.direction.OUTPUT:
                return cached
            else:
                cached.switch_to_output(value=value)
                return cached

        if cached is not None:
            cached.deinit()

        # Sensors need +5V power
        power.enable_periph_vcc(True)

        ret = digitalio.DigitalInOut(port)
        ret.switch_to_output()
        self._cache[port] = ret
        return self._cache[port]

    def pwm_out(self, port, duty_cycle=0, frequency=500):
        """Connect a PWM (pulse width modulation) peripheral to the specified pin.

        You can use this method to set up devices that want a (simulated) analog output,
        like an LED you control the brightness of.

        The peripheral will use a 16-bit PWM signal.
        Setting the :py:attr:`~pwmio.PWMOut.duty_cycle` attribute of the returned object changes the fraction
        of each pulse that is high, from no time at 0 to fully on at 65535.
        Setting the :py:attr:`~pwmio.PWMOut.frequency` attribute of the returned object changes the length of
        each pulse in Hertz.

        Args:
            port (microcontroller.Pin): Expansion port to configure.
            duty_cycle (int): Initial PWM duty cycle.
            frequency (int): Initial frequency.

        Returns:
            pwmio.PWMOut : A peripheral object representing the PWM output.
        """
        # Is port allowed, and is it being used already?
        if port not in self._cache:
            raise ValueError("Port not allowed")

        cached = self._cache[port]

        if isinstance(cached, pwmio.PWMOut):
            return cached

        if cached is not None:
            cached.deinit()

        # Sensors need +5V power
        power.enable_periph_vcc(True)

        ret = pwmio.PWMOut(port, duty_cycle=duty_cycle, frequency=frequency, variable_frequency=True)
        self._cache[port] = ret
        return self._cache[port]

    def deinit(self, port):
        """Releases peripheral port for other use.

        Args:
            port (microcontroller.Pin): Port to release
        """
        if port not in self._cache:
            raise ValueError("Port not allowed")
        try:
            self._cache[port].deinit()
        except AttributeError:
            # If pin is None, failing to deinit is fine
            pass
        self._cache[port] = None

    def servo_pwm(self, pin, duty_cycle=0, frequency=50):
        """Connect a PWM (pulse width modulation) peripheral to the specified pin.
        This can be used to control servos, or as a general-purpose oscillating output.

        Args:
            pin (microcontroller.Pin): The IO pin to use, for example exp.PORT1
            duty_cycle (int): duration pin is high during each period, with 65535 being 100%.
            frequency (int): periodic oscillation frequency in Hz (cycles per second)

        Returns:
            pwmio.PWMOut : The PWMOut object bound to specified pin.
        """
        return pwmio.PWMOut(pin, duty_cycle=duty_cycle, frequency=frequency)

    def make_pwm(self, pin, duty_cycle=0, frequency=50):
        return self.servo_pwm(pin, duty_cycle, frequency)

    def release_pwm(self, pwm):
        """Disconnect the internal PWM peripheral previously bound to a pin.

        Args:
            pwm (pwmio.PWMOut): A PWM peripheral created with make_pwm()
        """
        pwm.deinit()

    def set_servo(self, pwm, position_pct):
        """Set the position of a servo controlled with a PWM output.
        The PWM frequency must be 50Hz (default value of make_pwm()).
        **Note:** Many servos require position_pct value to exceed the ±100 range to reach
        their mechanical limits. Also an *offset* may be needed to center the servo.

        Args:
            pwm (pwmio.PWMOut): A PWM output created with make_pwm().
            position_pct (float): Desired servo position with "nominal" range -100 to +100. A value of 0 will "center" the servo.
        """
        pwm.duty_cycle = int((1.5 + position_pct / 200) * 65535 / 20)  # 1.5ms +/- 0.5ms


# Misc hardware access
_io_expander = ioexpander.IOExpander()

# CodeX subsystems
power = Power(_io_expander)
buttons = Buttons(_io_expander)
leds = LEDs(_io_expander)
pixels = NEOPixels()
audio = codec.Codec(_io_expander, power)
accel = Accelerometer(_io_expander.i2c)
light = AmbientLight(_io_expander.i2c, power)
exp = Expansion()

backlight = pwmio.PWMOut(board.IO6, duty_cycle=0, frequency=1000)
pwm_preserve(backlight) # maintain backlight operation after prog end.
tft = tft.TFT(transparent_color=0, backlight_pwm=backlight)
display = tft.display
console = tft.console
