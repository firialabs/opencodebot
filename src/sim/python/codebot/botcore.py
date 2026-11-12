"""Core low-level module for CodeBot-CB3.

The *botcore* module gives you direct access to all the hardware on the CodeBot CB3.
    * system = `System`
    * leds = `CB_LEDs`
    * exp = `Expansion`
    * spkr = `Speaker`
    * buttons = `Buttons`
    * prox == `Proximity`
    * ls = `LineSensors`
    * enc = `Encoders`
    * motors = `Motors`
    * accel = `KXTJ3`

"""
import time
import board
import digitalio
import analogio
import pwmio
import busio
import microcontroller
import cb3_drivers
import pca9557
from kxtj3 import KXTJ3
from cb3_drivers import runtime_us
from cb3_drivers import cosdac
import cb3pins as pin
from digitalio import DriveMode

ADC_FULL_SCALE = 65535


class System:
    """General system-level functions"""

    def __init__(self):
        self.VOLTAGE_RATIO = (59 + 107) / 59   # Voltage divider (production units)
        self.inp_pwr_is_usb = digitalio.DigitalInOut(pin.N_IS_USB)
        self.inp_pwr_is_usb.pull = digitalio.Pull.UP  # High if powered by USB
        self.batt_adc = analogio.AnalogIn(pin.BATT_SENS)

        # Init and unlock i2c bus
        self.i2c = board.I2C()
        self.flush_i2c()

    def __str__(self):
        return "{:.1f}V, {:.1f}F, {}".format(self.pwr_volts(), self.temp_F(), "USB" if self.pwr_is_usb() else "BATT")

    def flush_i2c(self):
        self.i2c.try_lock()
        for i in range(2):
            try:
                self.i2c.writeto(0, bytes([0]))
            except:
                pass
        self.i2c.unlock()

    def pwr_is_usb(self):
        """Are we powered by USB or Battery? (based on Power switch)

        Returns:
           int : 0 (Battery) or 1 (USB)
        """
        return int(self.inp_pwr_is_usb.value)

    def pwr_volts(self):
        """Measure power supply voltage (battery or USB)

        Returns:
           float : Power supply voltage
        """
        SAMPLES = 100
        adc_counts_total = 0
        for i in range(SAMPLES):
            adc_counts_total += self.batt_adc.value

        adc_counts = adc_counts_total / SAMPLES
        voltage = (adc_counts * self.batt_adc.reference_voltage) / ADC_FULL_SCALE
        return voltage * self.VOLTAGE_RATIO

    def temp_C(self):
        """Measure the temperature in Celsius

        Returns:
           float : degrees C
        """
        SAMPLES = 100
        temp_total = 0
        for i in range(SAMPLES):
            temp_total += microcontroller.cpu.temperature

        return temp_total / SAMPLES

    def temp_F(self):
        """Measure the temperature in Fahrenheit

        Returns:
           float : degrees F
        """
        return self.temp_C() * 9 / 5 + 32


class Expansion:
    """Access to the Expansion Port"""

    def __init__(self):
        pass
    
    def make_pwm(self, pin, duty_cycle=0, frequency=50):
        """Connect a PWM (pulse width modulation) peripheral to the specified pin.
        This can be used to control servos, or as a general-purpose oscillating output.

        Args:
            pin : The IO pin to use, for example pin.EXP_GPIO0
            duty_cycle : duration pin is high during each period, with 65535 being 100%.
            frequency : periodic oscillation frequency in Hz (cycles per second)

        Returns:
            pwmio.PWMOut : The PWMOut object bound to specified pin.
        """
        return pwmio.PWMOut(pin, duty_cycle=duty_cycle, frequency=frequency)

    def release_pwm(self, pwm):
        """Disconnect the internal PWM peripheral previously bound to a pin.

        Args:
            pwm : A PWM peripheral created with make_pwm()
        """
        pwm.deinit()

    def set_servo(self, pwm, position_pct):
        """Set the position of a servo controlled with a PWM output.
        The PWM frequency must be 50Hz (default value of make_pwm()).
        **Note:** Many servos require position_pct value to exceed the ±100 range to reach
        their mechanical limits. Also an *offset* may be needed to center the servo.

        Args:
            pwm : A PWM output created with make_pwm().
            position_pct : Desired servo position with "nominal" range -100 to +100. A value of 0 will "center" the servo.
        """
        pwm.duty_cycle = int((1.5 + position_pct / 200) * 65535 / 20)  # 1.5ms +/- 0.5ms


class Speaker:
    """Control the Speaker"""

    def __init__(self):
        # scae 1 = 1/2 output scale
        # offset 0 = no DC offset
        # invert 2 = invert bits to make a proper waveform
        cosdac.configure(1, 0, 2)

    def pitch(self, freq, duty=50):
        """Play a tone on the speaker, with the specified frequency and duty-cycle.

        This function uses the ESP32s2's cosine generator with best-fit parameters. 
        Expect some error in the output frequency.

        Args:
          freq (int): Frequency in Hertz       
          duty (int): Not used by CodeBot3   
        """
        cosdac.set_pitch(freq)

    def off(self):
        """Stop output to speaker."""
        cosdac.off()


class Buttons:
    """Access to pushbutton switches BTN-0 and BTN-1."""

    def __init__(self):
        self.btn0 = digitalio.DigitalInOut(pin.BTN_0)
        self.btn0.pull = digitalio.Pull.UP
        self.btn1 = digitalio.DigitalInOut(pin.BTN_1)
        self.btn1.pull = digitalio.Pull.UP
        cb3_drivers.enable_btn_isr()
        self.was_pressed()  # Discard initial interrupts during setup

    def __str__(self):
        return "{}".format(self.is_pressed())

    def was_pressed(self, num=None):
        """Return True if specified button was pressed since last call of this function.
        Default with num=None, returns tuple of both buttons status since last call.

        Args:
          num (int): 0 for BTN-0, 1 for BTN-1
        """
        if num is None:
            btn = (cb3_drivers.btn_was_pressed(0), cb3_drivers.btn_was_pressed(1))
            return btn
        elif 0 <= num < 2:
            return cb3_drivers.btn_was_pressed(num)
        else:
            raise ValueError("Button num must be 0, 1, or None")

    def is_pressed(self, num=None):
        """Return True if specified button is pressed, or tuple of both buttons if num=None.

        Args:
          num (int): 0 for BTN-0, 1 for BTN-1
        """
        if num is None:
            return (not self.btn0.value, not self.btn1.value)
        elif num == 0:
            return not self.btn0.value
        elif num == 1:
            return not self.btn1.value
        else:
            raise ValueError("Button num must be 0, 1, or None")


class LedDriver:
    def __init__(self):
        self.led_usb = digitalio.DigitalInOut(pin.USB_LED)
        self.led_usb.switch_to_output(False, DriveMode.PUSH_PULL)

        self.led_le = digitalio.DigitalInOut(pin.LED_LE)
        self.led_le.switch_to_output(False, DriveMode.PUSH_PULL)
        self.led_oe = digitalio.DigitalInOut(pin.LED_OE)
        self.led_oe.switch_to_output(True, DriveMode.PUSH_PULL)  # Init with output-enable OFF (high)

        self.led_spi = busio.SPI(pin.LED_CLK, pin.LED_SDI)
        self.led_spi.try_lock()
        self.led_spi.configure(baudrate=10000000, phase=0, polarity=0)

        # Proximity emitter-drive enables upper 16 bits of LEDs.
        self.prox_duty = 2**15   # 50%
        self.prox_pwm = pwmio.PWMOut(pin.PROX_PWM, duty_cycle=self.prox_duty, frequency=56000, variable_frequency=True)

        # Initialize for use
        self.write(0)
        self.enable(True)

    def enable(self, do_enable):
        # Assert active-low enable for LEDs
        self.led_oe.value = not do_enable
        self.prox_pwm.duty_cycle = self.prox_duty if do_enable else 0

    # Write 32-bit value to LED driver shift registers.
    #   'val' is big-endian bitmask:
    #        P7.   P6.   P5.   P4.   P3.    P2.    P1.    P0.
    #        PWR.  X_R.  X_L.  LS4.  LS3.   LS2.   LS1.   LS0
    #        B0.   B1.   B2.   B3.   B4.    B5.    B6.    B7.
    #        ER.   EL.   L2-0. L2-1. L03-0. L03-1. L14-0. L14-1.
    def write(self, val):
        bval = val.to_bytes(4, "big")  # Convert val to 32-bit big-endian bytes buffer
        self.led_spi.write(bval)
        # Latch-in the new data
        self.led_le.value = 1
        self.led_le.value = 0


class CB_LEDs:
    """Manage all the LEDs on CodeBot."""

    def __init__(self):
        self.driver = LedDriver()
        self.bits = 0

    def set_val(self, val, ofs, width):
        if val >= (1 << width):
            raise ValueError("LED value out of bounds")

        new_bits = self.bits
        mask = (1 << width) - 1
        new_bits = (new_bits & ~(mask << ofs)) | ((int(val) & mask) << ofs)
        if new_bits != self.bits:
            self.bits = new_bits
            self.driver.write(new_bits)

    @staticmethod
    def bools2bits(bool_iter):
        # Convert collection of bools to a bitmask integer
        if isinstance(bool_iter, (tuple, list)):
            bits = 0
            for i, b in enumerate(bool_iter):
                if b:
                    bits |= (1 << i)
            return bits
        elif isinstance(bool_iter, int):
            return bool_iter
        else:
            raise TypeError("LED value must be an int, tuple, or list")


    def user(self, b):
        """Set all User *Byte* LEDs to the given binary integer value or list/tuple of bools.

        Args:
            b : *int* value used to set LEDs, from 0 to 255 (2 :superscript:`8`-1) ; or,
            b : *list* of 8 bools.

        Example::

            leds.user(0)    # turn all User LEDs off
            leds.user(255)  # turn all User LEDs on
            leds.user(0b10101010)  # Alternating LEDs
            leds.user( [True, False, False, True, True, True, True, True] )

        """
        b = self.bools2bits(b)
        self.set_val(b, 8, 8)

    def user_num(self, num, val):
        """Set single User *Byte* LED.

        Args:
            num (int): Number of LED *bit*, 0-7.
            val (bool): Value of LED (``True`` or ``False``)
        """
        if 0 <= num < 8:
            self.set_val(int(val), num + 8, 1)
        else:
            raise ValueError("User LED must be in range 0-7.")

    def ls(self, b):
        """Set all User *Line Sensor* marker LEDs to the given binary integer value, or list/tuple of bools.

        Args:
            b : *int* value used to set LEDs, from 0 to 31 (2 :superscript:`5`-1), or
            b : *list* of 5 bools. (see `botcore.CB_LEDs.user` for example)
        """
        b = self.bools2bits(b)
        self.set_val(b, 16, 5)

    def ls_num(self, num, val):
        """Set single *Line Sensor* marker LED.

        Args:
            num (int): Number of LED *bit*, 0-4.
            val (bool): Value of LED (``True`` or ``False``)
        """
        if 0 <= num < 5:
            self.set_val(int(val), 16 + num, 1)
        else:
            raise ValueError("LS LED must be in range 0-4.")

    def ls_emit(self, ls_num, pwr):
        """Set *Line Sensor* infrared emitter LED to specified power level.

        Args:
            ls_num (int): Number of *Line Sensor* 0-4
            pwr (int): Power level 0-2
        """
        ls_ofs = (2, 0, 4, 2, 0)[ls_num]
        ls_val = (0, 1, 3)[pwr]
        self.set_val(ls_val, ls_ofs, 2)

    def pwr(self, is_on):
        """Set *Power* LED.

        Args:
            is_on (bool): Turn ON if ``True``
        """
        self.set_val(int(is_on), 23, 1)

    def usb(self, is_on):
        """Set *USB* LED.

        Args:
            is_on (bool): Turn ON if ``True``
        """
        self.driver.led_usb.value = is_on

    def enc_emit(self, b):
        """Set both *Encoder* emitter LEDs (2-bit value).

        Args:
            b (int): Binary value, 0=off, 1=left, 2=right, 3=both
        """
        self.set_val(b, 6, 2)

    def prox(self, b):
        """Set both Proximity marker LEDs.

        Args:
            b : *int* binary value, 0=off, 1=left, 2=right, 3=both ; or,
            b : *list* of 2 bools. (see `botcore.CB_LEDs.user` for example)
        """
        b = self.bools2bits(b)
        self.set_val(b, 21, 2)

    def prox_num(self, num, val):
        """Set single *Proximity* marker LED.

        Args:
            num (int): Number of LED *bit*, 0-1.
            val (bool): Value of LED (``True`` or ``False``)
        """
        if 0 <= num < 2:
            self.set_val(int(val), 21 + num, 1)
        else:
            raise ValueError("Prox LED must be 0 or 1.")

    def prox_emit(self, pwr):
        # Set power level 0-8, yeilding 0-80mA.
        # WARNING: LED not rated for continuous operation above 40mA (pwr=4)
        #val = (0x00, 0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFF)[pwr]
        val = (0x00, 0x01, 0x03, 0x07, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F)[pwr]
        self.set_val(val, 24, 8)


class Proximity:
    """Manage the proximity sensors"""

    _PROX_MARKER_LEDS = 0x00600000

    _PROX_FREQ_MAX = 54_000  # 100%
    _PROX_FREQ_MIN = 40_000  # 0%

    # Note: with lower freq at 34kHz (initial setting)
    # On a 0-100 % scale, barely gets under 40% before dropping to 0.
    # This is probably due to the response curve of the Vishay sensor flattening out below 40kHz.

    # Note: with lower freq at 34kHz (recommended setting),
    # on a 0-100 % scale, barely gets under 40% before dropping to 0.
    # This is probably due to the response curve of the Vishay sensor flattening out below 40kHz.

    def __init__(self, leds):
        self.leds = leds
        self.prox_l = digitalio.DigitalInOut(pin.PROX_L)
        self.prox_r = digitalio.DigitalInOut(pin.PROX_R)

        self._test_num = 15  # TODO mutable by the code in case we need to experiment

        # To support common use case of doing a prox-detect for both L&R sensors, we want to
        # do per-sensor successive approximation (binary search) without repeating emit/detect cycles
        # unnecessarily, which would waste time. That's why we cache sensor readings while ranging.
        self._prox_cache = {}

    def _mask_lights(self):
        # Turn off the front marker LEDs while making a Prox reading. Return the current mask for re-enabling
        mask = Proximity._PROX_MARKER_LEDS
        saved_markers = self.leds.bits & mask
        self.leds.bits &= ~mask
        return saved_markers

    def _restore_lights(self, saved_mask):
        self.leds.bits |= saved_mask
        # Make sure the restored value makes it out to the actual hardware...
        self.leds.driver.write(self.leds.bits)

    def _prox_detect(self, power, freq):
        left = right = False

        self.leds.prox_emit(power)

        # Note: datasheet says it requires at most 15 cycles for the IR sensor outputs
        leds.driver.prox_pwm.frequency = freq
        timeout = self._test_num * 1e6 / freq  # us

        start = runtime_us()
        while runtime_us() - start < timeout:
            left = not self.prox_l.value
            right = not self.prox_r.value
            if left and right:
                break  # Bail early if both sensors have positive detection

        # end = runtime_us()
        # print(f"elapsed={end - start}")

        self.leds.prox_emit(0)

        return (left, right)

    def _flush_prox_cache(self):
        self._prox_cache.clear()

    def _cached_prox_detect(self, pwr, freq):
        if freq in self._prox_cache:
            # Cache hit!
            return self._prox_cache[freq]

        # Cache miss
        sns = self._prox_detect(pwr, freq)

        # Store result in cache
        self._prox_cache[freq] = sns

        return sns

    def _prox_sweep(self, sensor, pwr, freq_min, freq_max, n_iter):
        # Sweep the frequencies from min to max and return the lowest.
        freq_detect = 0
        span = freq_max - freq_min
        cur_freq = freq_min  # Start at lowest freq = least sensitive detection
        for _ in range(n_iter):
            cf = int(cur_freq)
            det = self._cached_prox_detect(pwr, cf)
            if det[sensor]:
                freq_detect = cf
                if cur_freq > freq_min:
                    cur_freq -= span
                else:
                    break
            else:
                if cur_freq < freq_max:
                    cur_freq += span
                else:
                    break
            span = span / 2

        return freq_detect

    def detect(self, power=1, sens=100):
        """Return bool (L,R) of detection at given sensitivity level.

        Args:
            power (int): Emitter power (1-8).
            sens (int): Sensor sensitivity (0-100). Percent range from 0=least to 100=most sensitive.

        Returns:
            tuple of (L, R) bool detect status.
        """
        return self.range(1, power, sens)

    def range(self, samples=4, power=1, rng_low=0, rng_high=100):
        """Scan proximity sensors and return 0-100% range for each.
        This function runs a successive approximation algorithm to find the minimum range at which
        an object is detected by each sensor independently.

        Args:
            samples (int): Number of samples to read. Larger values give more accuracy at the expense of a longer scan time.
            power (int): Emitter power (0-8). (0=OFF,... 8=MAX)
            rng_low (int): Lowest sensitivity range (0-100) to scan within.
            rng_high (int): Highest sensitivity range (0-100) to scan within

        Returns:
            tuple of (L, R) int proximity values: 0-100 if object detected, or -1 if not.

            - If samples=1, returns bool (L, R) values.
            - **Note:** When samples=1 the **rng_high** value is not used. A single sample is taken at **rng_low**.
        """
        if samples < 1 or samples > 32:
            raise ValueError("Resolution must be integer range 1-32")
        if power < 0 or power > 8:
            raise ValueError("Power must be integer range 0-8")
        if rng_low > 100 or rng_high > 100 or rng_low > rng_high:
            raise ValueError("Range requires integer start<=stop<=100")

        markers = self._mask_lights()

        frange = (Proximity._PROX_FREQ_MAX - Proximity._PROX_FREQ_MIN) / 100

        # Convert percentages to frequencies
        fmin = int(Proximity._PROX_FREQ_MIN + rng_low * frange)
        fmax = int(Proximity._PROX_FREQ_MIN + rng_high * frange)

        self._flush_prox_cache()

        # Run the sweeps for left and right separately
        freq_left = self._prox_sweep(0, power, fmin, fmax, samples)
        freq_right = self._prox_sweep(1, power, fmin, fmax, samples)

        self._restore_lights(markers)
        self.leds.prox_emit(0)

        # Convert frequencies to percentages
        if freq_left:
            freq_left = (freq_left-Proximity._PROX_FREQ_MIN)/(Proximity._PROX_FREQ_MAX-Proximity._PROX_FREQ_MIN)*100
        else:
            freq_left = -1

        if freq_right:
            freq_right = (freq_right-Proximity._PROX_FREQ_MIN)/(Proximity._PROX_FREQ_MAX-Proximity._PROX_FREQ_MIN)*100
        else:
            freq_right = -1

        # For the case of 1 sample, we return booleans
        if samples > 1:
            return (int(freq_left), int(freq_right))
        else:
            return (freq_left > 0, freq_right > 0)


class LineSensors:
    """Manage the line sensors."""

    def __init__(self, leds):
        self.leds = leds
        # Line sensors - reversed order from schematic label vs silkscreen
        # Reflection = lower ADC value
        ls0_adc = analogio.AnalogIn(pin.LS0_SENS)
        ls1_adc = analogio.AnalogIn(pin.LS1_SENS)
        ls2_adc = analogio.AnalogIn(pin.LS2_SENS)
        ls3_adc = analogio.AnalogIn(pin.LS3_SENS)
        ls4_adc = analogio.AnalogIn(pin.LS4_SENS)

        self.emit_pwr = 2  # valid values are 1 (20mA) and 2 (40mA)
        self.sensor = (ls0_adc, ls1_adc, ls2_adc, ls3_adc, ls4_adc)
        self.thresh = 2500
        self.reflective_line = True

    def read_value_and_adjust(self, num):
        # Deal with hardware differences from CB2 as best we can
        # 1. 2.6 volt max supported by ESP32-S2 but CircuitPython scales for 3.3 volts
        # 2. 16-bit ADC reading instead of 12-bit
        temp = self.sensor[num].value
        # Theoretical scaling - comes out too high, presumably since it does not account for saturation, etc.
        # temp *= (3.3 / 2.6) # This is about 1.269ish
        # This conversion factor was determined empirically, by comparing readings between a CB2 and a CB3
        # temp *= 1.21745 # Still a little too high
        temp *= 1.215  # Close enough! CB2 reporting 4080 CB3 reporting 4086
        temp = int(temp)
        # Keep within the bounds of the physical (16-bit) hardware
        if temp > 65535:
            temp = 65535
        # Convert to 12-bit format like CB2 has
        temp >>= 4
        return temp

    def check(self, thresh=1000, is_reflective=False):
        """Fast check of all line sensors against threshold(s). Controls emitter also.

           Return a **tuple** of values for *all* line sensors. By default these are **bool** values indicating *presence of a line*,
           based on given parameters. See below for alternate behavior based on parameter types.

        Args:
            thresh(int): Threshold value to compare against sensor readings.
            is_reflective(bool): Set to True if the line being checked is reflective (white), False if not (black).

        Returns:
           tuple [5]: Collection of **bool** "line detected" values.

           - If *thresh=0*, returns raw ADC values (*ints*).
           - If *is_reflective* is an **int** value it is interpreted as *thresh_upper*, and the function returns -1,0,+1 for readings below/within/above thresholds.

        """
        vals = self.read_all()
        if thresh:
            if is_reflective:
                vals = [vals[i] < thresh for i in range(5)]
            else:
                vals = [vals[i] > thresh for i in range(5)]

        return tuple(vals)

    def calibrate(self, threshold, is_reflective_line):
        """Set parameters used to detect presence of a line.

        Args:
            threshold (int): Threshold of ADC reading, below which *reflection* is detected. 0-4095 (2 :superscript:`12`-1)
            is_reflective_line (bool): Is the line reflective?
        """
        self.thresh = threshold
        self.reflective_line = is_reflective_line

    def read(self, num):
        """Read the raw ADC value of selected *Line Sensor*.

        Args:
            num (int): Number of *Line Sensor* to read (0-1)
        """
        self.leds.ls_emit(num, self.emit_pwr)
        # microcontroller.delay_us(200)
        val = self.read_value_and_adjust(num)  # Convert to match CB2 ADCs.
        self.leds.ls_emit(num, 0)
        return val

    def read_all(self):
        self.leds.set_val(0x3F, 0, 6)  # all emitters on full power
        # microcontroller.delay_us(200)
        vals = [self.read_value_and_adjust(num) for num in range(5)]
        self.leds.set_val(0, 0, 6)
        return vals

    def is_line(self, num):
        """Check for presence of line beneath specified *Line Sensor* using current calibration parameters.

        Args:
            num (int): Number of *Line Sensor* to read (0-1)
        """
        detect = self.read(num) < self.thresh
        return detect if self.reflective_line else not detect


class Encoders:
    """Manage the wheel encoders.
    This class demonstrates simple low-level sensing of encoders via ADC channels. Higher performance implementations
    are available in separate modules, such as :mod:`timed_encoders`.
    """

    def __init__(self, leds):
        self.leds = leds
        enc_l_adc = analogio.AnalogIn(pin.ENC_L_SENS)
        enc_r_adc = analogio.AnalogIn(pin.ENC_R_SENS)
        self.sensor = (enc_l_adc, enc_r_adc)
        self.thresh = 2000

    def read(self, num):
        """Read given analog encoder value"""
        self.leds.enc_emit(1 << num)
        val = self.sensor[num].value >> 4  # Convert 16-bit CircuitPython API to 12-bit to match CB2 ADCs.
        self.leds.enc_emit(0)
        return val

    def is_slot(self, num):
        """Check for slot in given encoder disc"""
        return self.read(num) > self.thresh


class Motors:
    """Manage the *Motors*"""

    def __init__(self, i2c):
        self.pca = pca9557.PCA9557(i2c, 0x1C)
        self.pca.write(pca9557.REG_DIR, 0)  # All bits are outputs
        self.pwm = (
            pwmio.PWMOut(pin.ML_PWM, duty_cycle=0, frequency=1000, variable_frequency=False),
            pwmio.PWMOut(pin.MR_PWM, duty_cycle=0, frequency=1000, variable_frequency=False)
        )

        # Init with 0=Left, 1=Right
        self.in1 = (pin.MOTOR_L_IN1, pin.MOTOR_R_IN1)
        self.in2 = (pin.MOTOR_L_IN2, pin.MOTOR_R_IN2)

        self.enable(False)

    def enable(self, do_enable):
        """Enable the motors.

        Args:
            do_enable (bool): Set ``True`` to allow motors to run.
        """
        self.pca.setbits(pin.MOTOR_STBY, do_enable)

    def run(self, num, pwr):
        """Set specified *motor* to given *power* level.

        Args:
            num (int): Number of motor: 0 (LEFT) or 1 (RIGHT)
            pwr (int): Power -100% to +100% (neg=CW=reverse, pos=CCW=forward)
        """
        self.pca.setbits(self.in1[num], pwr < 0)
        self.pca.setbits(self.in2[num], pwr > 0)
        duty = int(abs(pwr) * 65535 / 100) & 0xFFFF
        self.pwm[num].duty_cycle = duty


# Instantiate core objects
system = System()
leds = CB_LEDs()
exp = Expansion()
spkr = Speaker()
buttons = Buttons()
prox = Proximity(leds)
ls = LineSensors(leds)
enc = Encoders(leds)
motors = Motors(system.i2c)
accel = KXTJ3(system.i2c, 0x0E)

# Helpful constants
LEFT = 0
RIGHT = 1
