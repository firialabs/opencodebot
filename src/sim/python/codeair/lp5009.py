"""LP5009 Driver - LED Controller
"""

#
# NOTE - This part is capable of driving RGB LEDs, but our hardware is monochrome (blue)
# I am not implementing extra features that we don't need (YAGNI).
# This also makes some of the register names confusing - the part can use it's nine
# output pins to drive nine monochrome LEDs, or 3 RGB LEDs. This is why you see references
# to LED0-LED2, but OUT0-OUT9.
#

# Possible Device Addresses (unshifted, which is how the CircuitPython libraries like it
BROADCAST_ADDRESS = 0b0001100
DEVICE_ADDRESS_0 = 0b0010100
DEVICE_ADDRESS_1 = 0b0010101
DEVICE_ADDRESS_2 = 0b0010110
DEVICE_ADDRESS_3 = 0b0010111

class LP5009:
    """Device Driver for LP5009 LED Controller, accessed via I2C bus"""

    # Registers inside the LP5009
    DEVICE_CONFIG0 = 0x00
    DEVICE_CONFIG1 = 0x01
    LED_CONFIG0 = 0x02
    BANK_BRIGHTNESS = 0x03
    BANK_A_COLOR = 0x04
    BANK_B_COLOR = 0x05
    BANK_C_COLOR = 0x06
    LED0_BRIGHTNESS = 0x07
    LED1_BRIGHTNESS = 0x08
    LED2_BRIGHTNESS = 0x09
    # LED3_BRIGHTNESS = 0A, but only on a sibling part, the LP5012
    OUT0_COLOR = 0x0B
    OUT1_COLOR = 0x0C
    OUT2_COLOR = 0x0D
    OUT3_COLOR = 0x0E
    OUT4_COLOR = 0x0F
    OUT5_COLOR = 0x10
    OUT6_COLOR = 0x11
    OUT7_COLOR = 0x12
    OUT8_COLOR = 0x13
    # Another gap in the numbering that IS used on the LP5012
    RESET = 0x17

    def _read(self, reg):
        """Read 8-bit register"""
        self._i2c.try_lock()
        try:
            self._buffer1[0] = reg
            self._i2c.writeto_then_readfrom(self._address, self._buffer1, self._buffer1)
            result = self._buffer1[0]
        finally:
            self._i2c.unlock()

        return result
        
    def _write(self, reg, val):
        """Write 8-bit register with 8-bit value"""
        self._i2c.try_lock()
        try:
            self._buffer2[0] = reg
            self._buffer2[1] = val
            self._i2c.writeto(self._address, self._buffer2)
        finally:
            self._i2c.unlock()

    def set_brightness(self, offset, level):
        if (offset < 0) or (offset > 8):
            return
        if (level < 0) or (level > 255):
            return
        self._write(self.OUT0_COLOR+offset, level)

    def get_brightness(self, offset):
        if (offset < 0) or (offset > 8):
            return 0
        return self._read(self.OUT0_COLOR+offset)

    def reset(self):
        self._write(self.DEVICE_CONFIG0, 0x40) # Set the Chip_EN bit
        # Here we are just re-writing the chip defaults, to get to a known starting point
        self._write(self.DEVICE_CONFIG1, 0x3C) # Log_Scale_EN, Power_Save_EN, Auto_Incr_EN, PWM_Dithering_EN
        self._write(self.LED_CONFIG0, 0x00) # We ARE NOT using (RGB) banking
        self._write(self.BANK_BRIGHTNESS, 0xFF) # Matching power-up default
        self._write(self.BANK_A_COLOR, 0x00) # We ARE NOT using (RGB) banking
        self._write(self.BANK_B_COLOR, 0x00) # ""
        self._write(self.BANK_C_COLOR, 0x00) # ""
        self._write(self.LED0_BRIGHTNESS, 0xFF) # ""
        self._write(self.LED1_BRIGHTNESS, 0xFF) # ""
        self._write(self.LED2_BRIGHTNESS, 0xFF) # ""

        for output in range(0,9):
            self.set_brightness(output, 0)

    def __init__(self, i2c, address=BROADCAST_ADDRESS):
        self._i2c = i2c
        self._address = address
        self._buffer1 = bytearray(1)
        self._buffer2 = bytearray(2)

        self.reset()
