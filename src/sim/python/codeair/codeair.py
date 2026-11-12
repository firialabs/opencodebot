"""Core low-level module for CodeAIR

The *codeair* module gives you direct access to all the hardware on the CodeAIR.

    * pixels = `NEOPixels`
    * buttons = `Buttons`
    * leds = `LEDs`
    * power = `Power`
    * speaker = `Speaker`
    * sdcard = `SDCard`
    * camera = `espcamera`
    * recorder = `FlightDataRecorder`
    * pipe = `EmbeddedDataPipe`

"""

# Circuitpython modules
import board
import neopixel
import analogio
import digitalio
import busio
import pwmio
import time
import espcamera
import sdcardio
import storage
import traceback

# Firia modules
import codeair_drivers
from colors import *
import lp5009
import recorder as data_recorder
from embedded_data import EmbeddedDataPipe

# Buttons (using same naming convention as CodeX)
BTN_0 = 0
BTN_1 = 1

# NeoPixel placement
TOP_FRONT_RIGHT = 0    
TOP_FRONT_LEFT = 2     
TOP_REAR_RIGHT = 6     
TOP_REAR_LEFT = 5      
BOTTOM_FRONT_RIGHT = 1 
BOTTOM_FRONT_LEFT = 3  
BOTTOM_REAR_RIGHT = 7  
BOTTOM_REAR_LEFT = 4   

# PIXELS_TOP = (TOP_FRONT_LEFT, TOP_FRONT_RIGHT, TOP_REAR_RIGHT, TOP_REAR_LEFT)  #: Top pixels
# PIXELS_BOT = (BOTTOM_FRONT_LEFT, BOTTOM_FRONT_RIGHT, BOTTOM_REAR_RIGHT, BOTTOM_REAR_LEFT) #: Bottom pixels

# Eight blue LEDs
LED_0 = 0
LED_1 = 1
LED_2 = 2
LED_3 = 3
LED_4 = 4
LED_5 = 5
LED_6 = 6
LED_7 = 7
LED_STA = 8

class NEOPixels:
    """Access to the eight CodeAIR neopixels.

    .. code-block:: python

        (TOP_FRONT_RIGHT, TOP_FRONT_LEFT, TOP_REAR_RIGHT, TOP_REAR_LEFT,
        BOTTOM_FRONT_RIGHT, BOTTOM_FRONT_LEFT, BOTTOM_REAR_RIGHT, BOTTOM_REAR_LEFT)

    """

    DEFAULT_BRIGHTNESS = 10 # percent

    def __init__(self):
        self._strip = neopixel.NeoPixel(board.NEOPIXEL, 8, pixel_order='GRB')
        self.off()

    def set(self, num, value=WHITE, brightness=DEFAULT_BRIGHTNESS):
        """Set the RGB state of the CodeAIR Neopixels.

        Args:
            num (int/list/tuple) : Pixel number (0,1,2,3,4,5,6,7 or a list of 8 values to set all pixels)
            value (tuple): A tuple of three values for RGB like (10,88,102)
            brightness (int): Value between 0 - 100 to scale the brightness of the RGBs
        """
        if isinstance(num, list) or isinstance(num, tuple):
            if len(num) != 8:
                raise ValueError('Must provide exactly 8 pixels')
            for i in range(8):
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
        if isinstance(value, list) or isinstance(value, tuple):
            rgb = scale_rgb(value, brightness)
            self._strip.fill(rgb)
        else:
            raise TypeError('Invalid color value - must be tuple or list')

    def get(self, num=None):
        """Get current RGB value of Codex NeoPixels. This will be the value after brightness was applied.

        Args:
            num (int/None): A number from 0 - 7 will return a single value, None will return tuple of all 8 values.

        Returns:
            value (tuple/tuple of 8 tuples)
        """
        if num is None:
            return tuple([self._strip[0], self._strip[1], self._strip[2], self._strip[3], self._strip[4], self._strip[5], self._strip[6], self._strip[7]])
        elif num >= 0 and num < 8:
            return self._strip[num]
        else:
            raise ValueError('num must be an int from 0-4 or None')

class Buttons:
    """Access to pushbutton switches BTN-0 and BTN-1."""

    def __init__(self):
        self.btn0 = digitalio.DigitalInOut(board.BTN_0)
        self.btn0.pull = digitalio.Pull.UP
        self.btn1 = digitalio.DigitalInOut(board.BTN_1)
        self.btn1.pull = digitalio.Pull.UP
        codeair_drivers.enable_btn_isr()
        self.was_pressed()  # Discard initial interrupts during setup

    def __str__(self):
        return "{}".format(self.is_pressed())

    def was_pressed(self, num=None):
        """Return True if specified button was pressed since last call of this function.
        Default with num=None, returns tuple of both buttons status since last call.

        Args:
            num (int): 0 for BTN_0, 1 for BTN_1
        """
        if num is None:
            result = (codeair_drivers.btn_was_pressed(0), codeair_drivers.btn_was_pressed(1))
            return result
        elif 0 <= num < 2:
            return codeair_drivers.btn_was_pressed(num)
        else:
            raise ValueError("Button num must be 0, 1, or None")

    def is_pressed(self, num=None):
        """Return True if specified button is pressed, or tuple of both buttons if num=None.

        Args:
            num (int): 0 for BTN_0, 1 for BTN_1
        """
        if num is None:
            return (not self.btn0.value, not self.btn1.value)
        elif num == 0:
            return not self.btn0.value
        elif num == 1:
            return not self.btn1.value
        else:
            raise ValueError("Button num must be 0, 1, or None")

class LEDs:
    """Access to the eight blue LEDs on the CodeAIR, plus the STAtus LED."""

    # The board was laid out such that the LEDs are in the opposite order
    # from the silk-screen labeling. This routine compensates for that.
    def _remap(self, num):
        return 7-num

    def __init__(self, i2c):
        self._led_driver = lp5009.LP5009(i2c)

    def get(self, num=None):
        """Get the current brightness of an LED or all LEDs if None is specified.

        Returns:
            number : brightness (0-255) of given LED num, OR
            tuple  : eight numbers -- one for each LED
        """

        if num is None:
            ret = tuple(self._led_driver.get_brightness(self._remap(i)) for i in range(8))
        elif type(num) == int and 0 <= num <= 7:
            ret = self._led_driver.get_brightness(self._remap(num))
        else:
            raise ValueError('LED number must be 0-7')

        return ret

    def set(self, num, brightness):
        """Set the brightness of one or more LEDs

        Args:
            num (int) : LED number (0-7) OR (tuple) : multiple LED numbers
            brightness (int) : (0-255) OR (tuple of ints) : multiple brightness values
        """
        if isinstance(brightness, bool):
            brightness = 10 * int(brightness)

        if isinstance(num, int):
            if num < 0 or num > 7:
                raise ValueError("LED num must have a value between 0 and 7.")
            if brightness < 0 or brightness > 255:
                raise ValueError("LED brightness must have a value between 0 and 255.")
            self._led_driver.set_brightness(self._remap(num), brightness)
        elif isinstance(num, list) or isinstance(num, tuple):
            if isinstance(brightness, int):
                if brightness < 0 or brightness > 255:
                    raise ValueError("LED brightness must have a value between 0 and 255.")
                for i in num:
                    if i < 0 or i > 7:
                        raise ValueError("LED numbers must have a value between 0 and 7.")
                    self._led_driver.set_brightness(self._remap(i), brightness)
            elif isinstance(brightness, list) or isinstance(brightness, tuple):
                if len(num) != len(brightness):
                    raise ValueError("Must specify the same number of brightness values as LED numbers.")
                for index in range(len(num)):
                    led_num = num[index]
                    led_brightness = brightness[index]
                    if led_num < 0 or led_num > 7:
                        raise ValueError("LED numbers must have a value between 0 and 7.")
                    if led_brightness < 0 or led_brightness > 255:
                        raise ValueError("LED brightness must have a value between 0 and 255.")
                    self._led_driver.set_brightness(self._remap(led_num), led_brightness)
            else:
                raise ValueError('Incorrect type(s) supplied to set()')
        else:
            raise ValueError('Incorrect type(s) supplied to set()')

    def set_mask(self, bitmask, brightness):
        """Set the brightness of all LEDs using a binary mask

        Args:
            bitmask (int) : 0-255, but represents a bitmask of which LEDs should be ON (1 bits) or OFF (0 bits)
                            b7 (128) corresponds to LED 7, b6 (64) corresponds to LED 6, down to b0 (1) corresponds to LED 0
            brightness (int) : 0-255 is allowed, but 0 is somewhat redundant
        """
        if isinstance(brightness, bool):
            brightness = 10 * int(brightness)
            
        if isinstance(bitmask, int) and isinstance(brightness, int):
            if bitmask < 0 or bitmask > 255:
                raise ValueError("LED bitmask must have a value between 0 and 255.")
            if brightness < 0 or brightness > 255:
                raise ValueError("LED brightness must have a value between 0 and 255.")
            bit = 0x80
            led = 7
            while bit > 0:
                if bit & bitmask:
                    intensity = brightness
                else:
                    intensity = 0
                self._led_driver.set_brightness(self._remap(led), intensity)
                bit >>= 1
                led -= 1
        else:
            raise ValueError('Incorrect type(s) supplied to set_mask()')

    def get_status(self):
        """Get the current brightness of the status LED.

        Returns:
            number : brightness (0-255) of the status LED
        """

        ret = self._led_driver.get_brightness(LED_STA)

        return ret

    def set_status(self, brightness):
        """Set the brightness of the status LED

        Args:
            brightness (int) : (0-255)
        """
        if isinstance(brightness, bool):
            brightness = 10 * int(brightness)
        
        if isinstance(brightness, int):
            if brightness < 0 or brightness > 255:
                raise ValueError("Status LED brightness must have a value between 0 and 255.")
            self._led_driver.set_brightness(LED_STA, brightness)
        else:
            raise ValueError('Incorrect type supplied to set_status()')

    def toggle(self, num):
        """Toggle an LED using default brightness"""
        self.set(num, not self.get(num))

class Power:
    """Access to the CodeAIR power monitoring."""
    ADC_FULL_SCALE = 65535

    # Hardware is doing a divide by 2 (resistor divider), which we undo via the following
    BATTERY_VOLTAGE_SCALING = 2.0

    # BQ24079 Battery Charger datasheet Section 9.3.5.1 on page 25 says:
    # V_ISET = I_CHARGE / 400 * R_ISET
    # Rearranged (Algebra!) to get:
    # I_CHARGE = V_ISET * 400 / R_ISET
    # R_ISET is 1780 Ohms on the schematic
    CHARGER_CURRENT_SCALING = 400.0 / 1780.0

    def __init__(self):
        # Two Analog pins for voltage and current
        self._battery_voltage_adc = analogio.AnalogIn(board.BATT_MON)
        self._charger_current_adc = analogio.AnalogIn(board.CHG_CURRENT)
        # One Digital pin to detect USB power is coming in
        self._usb_power_status = digitalio.DigitalInOut(board.USB_PGOODN)

    def _get_averaged_ADC(self, adc, num_samples):
        adc_counts_total = 0
        count = num_samples
        while count > 0:
            adc_counts = adc.value
            adc_counts_total += adc_counts
            count -= 1
        adc_counts = adc_counts_total / num_samples
        return adc_counts

    def battery_voltage(self, sample_count=2000, battery_minimum = 3.0):
        """Measure the battery voltage.

        A sample_count of 1 seems sufficient when a battery is connected,
        but when a battery is not connected, the computer sees a voltage that is output periodically by
        the battery CHARGER. 2000 or more samples are necessary to filter out these readings.

        battery_minimum parameter allows observing effects of the battery charger with no battery connected.

        Typical use case:

        .. code-block:: python

            volts = power.battery_voltage() # slow but accurate

        If you know for sure a battery is connected:

        .. code-block:: python

            volts = power.battery_voltage(1) # faster but can be "tricked" by the voltage put out by the battery charger
        
        If you want to see the real-world effects of the battery charger "probing" to see if a battery has been connected:
            
        .. code-block:: python

            volts = power.battery_voltage(1, 0.0)

        Args:
            sample_count (int) : 1 or higher. 
            battery_minimum (float): defaults to 3.0 

        Returns:
            float : Battery voltage in volts
        """
        if sample_count < 1:
            sample_count = 1
        adc_counts = self._get_averaged_ADC(self._battery_voltage_adc, sample_count)
        # Convert ADC Counts to Volts
        voltage = (adc_counts * self._battery_voltage_adc.reference_voltage) / Power.ADC_FULL_SCALE
        # Account for the resistor dividor network in the hardware
        voltage *= Power.BATTERY_VOLTAGE_SCALING
        # Enforce the minimum usable voltage, since the battery charger is outputting voltage too
        if voltage < battery_minimum:
            voltage = 0.0
        return voltage

    def charger_current(self, sample_count=1):
        """Measure the battery charger current. Note that it will be 0 when the charger is not actually charging.

        Args:
            sample_count (int) : 1 or higher. The default of 1 seems sufficient, but we chose to match the capabilities
                                 of the battery_voltage() function

        Returns:
            float : Battery charger current in amps
        """
        if sample_count < 1:
            sample_count = 1
        adc_counts = self._get_averaged_ADC(self._charger_current_adc, sample_count)
        # Convert ADC Counts to Volts
        voltage = (adc_counts * self._charger_current_adc.reference_voltage) / Power.ADC_FULL_SCALE
        # Per the schematic
        current = voltage * Power.CHARGER_CURRENT_SCALING
        return current

    def is_usb(self):
        """Are we powered by USB or Battery?

        Returns:
            bool : True (USB) or False (Battery)
        """
        # On the schematic, the signal is named USB_PGOODn, so it indicates
        # when we are running from USB power, but it is an active low signal.
        return not self._usb_power_status.value

class Speaker:
    """Access to the CodeAIR speaker."""

    def __init__(self):
        self._pwm = pwmio.PWMOut(board.SPK, duty_cycle=0, frequency=440, variable_frequency=True)

    def off(self):
        """Stop outputting sound.
        """
        self._pwm.duty_cycle = 0

    def beep(self, frequency=440, duration=250, duty_cycle=32767):
        """Output a beep (possibly continuous)

        Args:
            frequency (int) : xxx or higher. The default value of 440 corresponds to a musical note "A4"
            duration (int): Must be >= 0, with 0 being a special case used for starting a beep and leaving it running
                When not equal to 0, duration indicates the number of milliseconds to play the beep for.
            duty_cycle (16-bit int) : can be used to vary the width of the pulses sent to the speaker, which will
                have some effect on the sound characteristics and volume (you can hear the sound get "thinner" as you
                move off the center point, which is 32767)

        Returns:
            None
        """
        if not isinstance(frequency, int):
            raise ValueError('Incorrect type supplied to beep() for frequency (should be int)')
        if not isinstance(duration, int):
            raise ValueError('Incorrect type supplied to beep() for duration (should be int)')
        if not isinstance(duty_cycle, int):
            raise ValueError('Incorrect type supplied to beep() for duty_cycle (should be int)')

        if frequency < 1:
            raise ValueError('Incorrect value supplied to beep() for frequency (should be > 0)')
        # TODO Decide if we should enforce an upper limit. Currently we are limited by the speaker

        if duration < 0:
            raise ValueError('Incorrect value supplied to beep() for duration (should be >= 0)')
        # TODO Decide if we should enforce an upper limit. This is a blocking function...

        if (duty_cycle < 0) or (duty_cycle > 65535):
            raise ValueError('Incorrect value supplied to beep() for duty_cycle (should be 0-65535)')

        time_value = duration / 1000.0

        self._pwm.frequency = frequency
        self._pwm.duty_cycle = duty_cycle
        if time_value == 0.0:
            return
        else:
            time.sleep(time_value)
            self.off()

class SDCard:
    """Access the SD Card - Flight Data Recorder.
       This provides a filesystem on '/sd' for Python (no USB direct MSC access).
       When the SD card is removed/reinserted you'll need to call 'mount()' again.
    """
    SCLK = board.D40
    MOSI = board.D39
    MISO = board.D41
    CS = board.D2

    def __init__(self, baudrate=25000000):
        self.baudrate = baudrate
        self.testbuf = None
        self.path = '/sd'
        self.spi = busio.SPI(self.SCLK, self.MOSI, self.MISO)
        self.sd = None
        # self.mount()  # Not mounting by default, to prevent bad SD card from hanging system

    def deinit(self):
        self.umount()
        self.spi.deinit()

    def mount(self):
        """Attempt to mount the SD card. Returns True if successful."""
        self.umount()  # Ensure success even if SD has been removed/reinserted
        try:
            # Will OSError if no SD present
            self.sd = sdcardio.SDCard(self.spi, self.CS, self.baudrate)
            self.vfs = storage.VfsFat(self.sd)
            storage.mount(self.vfs, self.path)
        except:
            pass

        return bool(self.sd)

    def umount(self):
        """Disconnect SD interface from filesystem"""
        if self.sd:
            try:
                self.sd.sync()  # commit any pending writes
                storage.umount(self.path)
            except:
                pass

            self.sd.deinit()
            self.sd = None

    def is_ready(self):
        """Return True if SD card is present and readable"""
        if not self.sd:
            return False
        
        ready = False
        try:
            if not self.testbuf:
                self.testbuf = bytearray(512)
            self.sd.readblocks(0, self.testbuf)
            ready = True
        except:
            pass

        return ready



# CodeAIR subsystems
pixels = NEOPixels()
buttons = Buttons()
power = Power()
speaker = Speaker()
cam_i2c = busio.I2C(board.CAM_SCL, board.CAM_SDA)
leds = LEDs(cam_i2c)
sdcard = SDCard()
recorder = data_recorder.FlightDataRecorder()
pipe = EmbeddedDataPipe()

try:
    camera = espcamera.Camera(
        data_pins=board.CAMERA_DATA,
        external_clock_pin=board.CAMERA_XCLK,
        pixel_clock_pin=board.CAMERA_PCLK,
        vsync_pin=board.CAMERA_VSYNC,
        href_pin=board.CAMERA_HREF,
        pixel_format=espcamera.PixelFormat.RGB565,
        frame_size=espcamera.FrameSize.QQVGA,
        grab_mode=espcamera.GrabMode.LATEST,
        i2c=cam_i2c,
        external_clock_frequency=20000000,
        framebuffer_count=2
    )
except Exception as e:
    print("Error starting camera! ", e)
    camera = None
