import time

"""KXTJ3 Driver - i2c Accelerometer

This module provides high-level functions to access the basic accelerometer features,
and low-level functions to allow access to the full register set for advanced usage.

Many advanced features are available - see `datasheet <https://www.kionix.com/product/KXTJ3-1057>`_
"""


class KXTJ3:
    """Device driver for KXTJ3 accelerometer, controlled via i2c bus."""
    # Kionix Reserved - 0x00 – 0x05
    XOUT_L = 0x06  # R
    XOUT_H = 0x07  # R
    YOUT_L = 0x08  # R
    YOUT_H = 0x09  # R
    ZOUT_L = 0x0A  # R
    ZOUT_H = 0x0B  # R
    DCST_RESP = 0x0C  # R
    # Kionix Reserved - 0x0D – 0x0E
    WHO_AM_I = 0x0F  # R
    # Kionix Reserved - 0x10 – 0 x15
    INT_SOURCE1 = 0x16  # R
    INT_SOURCE2 = 0x17  # R
    STATUS_REG = 0x18  # R
    # Kionix Reserved - 0x19
    INT_REL = 0x1A  # R
    CTRL_REG1 = 0x1B  # R/W
    # Kionix Reserved - 0x1C
    CTRL_REG2 = 0x1D
    INT_CTRL_REG1 = 0x1E  # R/W
    INT_CTRL_REG2 = 0x1F  # R/W
    # Kionix Reserved - 0x20
    DATA_CTRL_REG = 0x21  # R/W
    # Kionix Reserved - 0x22 – 0x28
    WAKEUP_COUNTER = 0x29  # R/W
    NA_COUNTER = 0x2A  # R/W
    # Kionix Reserved - 0x2B – 0x39
    SELF_TEST = 0x3A  # W
    # Kionix Reserved - 0x3B – 0x69
    WAKEUP_THRESHOLD_H = 0x6A  # R/W
    WAKEUP_THRESHOLD_L = 0x6B  # R/W


    def __init__(self, i2c, addr=0x0E):
        self.i2c = i2c
        self._address = addr
        self._buffer1 = bytearray(1)
        self._buffer2 = bytearray(2)
        self._buffer6 = bytearray(6)
        self.orientation = (0, 0, 0)

        self.reset()

    def read(self):
        """Read current XYZ axis values and update 'self.orientation' tuple

        Returns:
            `tuple` of (x, y, z) axis values.

            - Default full-scale range is ±2g.
            - Values are signed 16-bit integer (-32767 to +32768)
        """

        self._read_multiple_registers(KXTJ3.XOUT_L, self._buffer6)

        x = (self._buffer6[1] << 8) | self._buffer6[0]
        y = (self._buffer6[3] << 8) | self._buffer6[2]
        z = (self._buffer6[5] << 8) | self._buffer6[4]

        x = (x & 0x8000) - (x & 0x7fff)
        y = (y & 0x8000) - (y & 0x7fff)
        z = (z & 0x8000) - (z & 0x7fff)

        # Change accelerometer coords to match (x,y,z) on PCB silkscreen
        self.orientation = (-y, -x, z)

        return self.orientation

    def dump_axes(self):
        """Debug - send axis values to stdout"""
        print("X={}, Y={}, Z={}".format(*self.read()))

    # Advanced API

    def verify_id(self):
        """Verify the part id. Return True if passed."""
        return self._read_register(KXTJ3.WHO_AM_I) == 0x35

    def reset(self):
        """Reset the accelerometer to expected configuration."""

        # Go to stand-by mode while we configure the registers
        self._write_register(KXTJ3.CTRL_REG1, 0)

        # Software reset
        # https://kionixfs.azureedge.net/en/document/TN017-Power-On-Procedure.pdf

        self._write_register(KXTJ3.CTRL_REG2, 0)
        self._write_register(KXTJ3.CTRL_REG2, 0x80)
        time.sleep(0.002)  # Software Reset Time max

        # Configure the registers
        # Stand-by, High-Res, Interrupts-Off, 2g, Wakeup-Disabled
        self._write_register(KXTJ3.CTRL_REG1, 0b_0_1_0_000_0_0)
        # self._write_register(KXTJ3.CTRL_REG1 # Nothing to change (we are not using wakeup function)
        # self._write_register(KXTJ3.INT_CTRL_REG1 # Nothing to change (we are not using interrupts yet)
        # self._write_register(KXTJ3.INT_CTRL_REG2 # Nothing to change (we are not using interrupts yet)
        self._write_register(KXTJ3.DATA_CTRL_REG, 0b_0000_0110)  # 800Hz
        # self._write_register(KXTJ3.WAKEUP_COUNTER # Nothing to change (we are not using wakeup function)
        # self._write_register(KXTJ3.NA_COUNTER # Nothing to change (we are not using wakeup function)
        # self._write_register(KXTJ3.WAKEUP_THRESHOLD_H # Nothing to change (we are not using wakeup function)
        # self._write_register(KXTJ3.WAKEUP_THRESHOLD_L # Nothing to change (we are not using wakeup function)

        # Back to operational mode
        # Stand-by, High-Res, Interrupts-Off, 2g, Wakeup-Disabled
        self._write_register(KXTJ3.CTRL_REG1, 0b_1_1_0_000_0_0)

    def _write_register(self, reg, value):
        """Write 8-bit register"""
        self.i2c.try_lock()
        try:
            self._buffer2[0] = reg
            self._buffer2[1] = value
            self.i2c.writeto(self._address, self._buffer2)
        finally:
            self.i2c.unlock()

    def _read_register(self, reg):
        """Read 8-bit register"""
        self.i2c.try_lock()
        try:
            self._buffer1[0] = reg
            self.i2c.writeto_then_readfrom(self._address, self._buffer1, self._buffer1)
            return self._buffer1[0]
        finally:
            self.i2c.unlock()

    def _read_multiple_registers(self, start, buffer):
        """Read several registers at once"""
        self.i2c.try_lock()
        try:
            self._buffer1[0] = start
            self.i2c.writeto_then_readfrom(self._address, self._buffer1, buffer)
        finally:
            self.i2c.unlock()

    def self_test(self):
        """Run self-test. Return True if passed"""
        # Get the "normal" readings
        normal_values = self.read()
        reg1 = self._read_register(KXTJ3.CTRL_REG1)
        # To stand-by mode
        self._write_register(KXTJ3.CTRL_REG1, reg1 & 0x7F)
        # Turn on test deflection
        self._write_register(KXTJ3.SELF_TEST, 0xCA)
        # Back to operation mode
        self._write_register(KXTJ3.CTRL_REG1, reg1 | 0x80)
        # Brief delay needed to allow time for mechanical deflection
        time.sleep(0.1)
        # Get the "testing" readings
        test_values = self.read()
        # Back to stand-by mode
        self._write_register(KXTJ3.CTRL_REG1, reg1 & 0x7F)
        # Turn off test deflection
        self._write_register(KXTJ3.SELF_TEST, 0x00)
        # Back to operation mode
        self._write_register(KXTJ3.CTRL_REG1, reg1 | 0x80)

        # Typical deflection is 0.5g. With our 2g config, we get
        # 32K/2 = 16K for 1g. Half a g is thus 8K.
        # Remember, we flipped X.
        # Check that the axes changed between 4096 and 12288 (8K +- 4K)
        deflections = (abs(test_values[0]-normal_values[0]),
                       abs(test_values[1]-normal_values[1]),
                       abs(test_values[2]-normal_values[2]))
        for d in deflections:
            if d < 4096 or d >= 12288:
                return False
        return True
