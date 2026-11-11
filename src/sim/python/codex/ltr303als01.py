"""Driver for ltr303als01 Light Sensor

https://optoelectronics.liteon.com/upload/download/DS86-2013-0004/LTR-303ALS-01_DS_V1.pdf
"""

#The I2C address on this chip is fixed
ALS_ADDR = 0x29

# Registers
ALS_CONTR = 0x80  # Operation mode, SW reset
ALS_MEAS_RATE = 0x85  # Measurement rate in active mode
ALS_PART_ID = 0x86  # Part Number ID and Revision ID
ALS_MANUFAC_ID = 0x87  # Manufacturer ID
ALS_DATA_CH1_0 = 0x88  # LSB of Channel 1 Measurement
ALS_DATA_CH1_9 = 0x89  # MSB of Channel 1 Measurement
ALS_DATA_CH0_0 = 0x8A  # LSB of Channel 0 Measurement
ALS_DATA_CH0_9 = 0x8B  # MSB of Channel 0 Measurement
ALS_STATUS = 0x8C  # New data status
ALS_INTERRUPT = 0x8F  # Interrupt settings
ALS_THRES_UP_0 = 0x97  # LSB of interrupt upper threshold
ALS_THRES_UP_1 = 0x98  # MSB of interrupt upper threshold
ALS_THRES_LOW_0 = 0x99  # LSB of interrupt lower threshold
ALS_THRES_LOW_1 = 0x9A  # MSB of interrupt lower threshold
ALS_INTERRUPT_PERSIST = 0x9E  # Interrupt persist setting

# For ALS_CONTR register
ALS_GAIN_1X = 0b000 << 2  # 1 lux to 64k lux
ALS_GAIN_2X = 0b001 << 2  # 0.5 lux to 32k lux
ALS_GAIN_4X = 0b010 << 2  # 0.25 lux to 16k lux
ALS_GAIN_8X = 0b011 << 2  # 0.125 lux to 8k lux
# 0b100 and 0b101 are reserved / do not use
ALS_GAIN_48X = 0b110 << 2  # 0.02 lux to 1.3k lux
ALS_GAIN_96X = 0b111 << 2  # 0.01 lux to 600k lux

ALS_GAIN_MASK = 0b111 << 2
ALS_SW_RESET = 0b10  # Set this bit to reset the chip
ALS_ACTIVE_MODE = 0b1  # else in standby mode

# For ALS_MEAS_RATE
# TODO

# For ALS_PART_ID
ALS_EXPECTED_PART_ID = 0xA0  # per the datasheet
ALS_PART_NUMBER_MASK = 0xF0
ALS_REVISION_MASK = 0x0F

# For ALS_MANUFAC_ID
ALS_EXPECTED_MANUFAC_ID = 0x05  # per the datasheet

# For ALS_STATUS
ALS_STATUS_DATA_VALID = 0x80
ALS_STATUS_INTERRUPT_PENDING = 0x08
ALS_STATUS_NEW_DATA = 0x04

# For ALS_INTERRUPT
ALS_INTERRUPT_ACTIVE_HIGH = 0x04
ALS_INTERRUPT_ENABLE = 0x02

class LTR303ALS01():
    """Ambient light sensor driver"""
    def __init__(self, i2c):
        self.i2c = i2c

        self.cmdbuf = bytearray(1)
        self.cmd1databuf = bytearray(2)
        self.cmd2databuf = bytearray(3)
        self.resultbuf = bytearray(1)
        self.databuf = bytearray(4)

        self.contr_shadow = 0x00

        self.enter_sw_reset()

        self.interrupt_shadow = 0x00

        self.lower_threshold = 0x0000
        self.upper_threshold = 0xffff

        self.exit_sw_reset()

        self.chip_detected = False
        if self.read(ALS_MANUFAC_ID) == ALS_EXPECTED_MANUFAC_ID:
            id_and_rev = self.read(ALS_PART_ID)
            id = id_and_rev & ALS_PART_NUMBER_MASK
            if id == ALS_EXPECTED_PART_ID:
                self.chip_detected = True

            # Init to measurement rate = 100ms, integration time = 100ms
            self.write(ALS_MEAS_RATE, 0x01)

    def read(self, register_num):
        """Read internal register"""
        self.cmdbuf[0] = register_num
        self.i2c.try_lock()
        self.i2c.writeto(ALS_ADDR, self.cmdbuf)

        self.i2c.readfrom_into(ALS_ADDR, self.resultbuf)
        result = self.resultbuf[0]

        self.i2c.unlock()
        return result

    def write(self, register_num, value):
        """Write internal register"""
        cmd = self.cmd1databuf
        cmd[0] = register_num
        cmd[1] = value

        self.i2c.try_lock()
        self.i2c.writeto(ALS_ADDR, cmd)
        self.i2c.unlock()

    def go_active(self):
        self.contr_shadow |= ALS_ACTIVE_MODE
        self.write(ALS_CONTR, self.contr_shadow)

    def go_standby(self):
        self.contr_shadow &= ~ALS_ACTIVE_MODE
        self.write(ALS_CONTR, self.contr_shadow)

    def set_gain(self, gain):
        if gain not in (ALS_GAIN_1X, ALS_GAIN_2X, ALS_GAIN_4X, ALS_GAIN_8X, ALS_GAIN_48X, ALS_GAIN_96X):
            return
        self.contr_shadow &= ~ALS_GAIN_MASK
        self.contr_shadow |= gain
        self.write(ALS_CONTR, self.contr_shadow)

    def enter_sw_reset(self):
        self.contr_shadow |= ALS_SW_RESET
        self.write(ALS_CONTR, self.contr_shadow)

    def exit_sw_reset(self):
        self.contr_shadow &= ~ALS_SW_RESET
        self.write(ALS_CONTR, self.contr_shadow)

    def enable_interrupt(self):
        activate_needed = False
        if self.contr_shadow & ALS_ACTIVE_MODE:
            activate_needed = True
            self.go_standby()
        self.interrupt_shadow |= ALS_INTERRUPT_ENABLE
        self.write(ALS_INTERRUPT, self.interrupt_shadow)
        if activate_needed:
            self.go_active()

    # NOTE!- Reading the data clears the interrupt status bit,
    # making it hard to verify if you are POLLING for data.
    def is_amb_irq(self):
        """Return True if IRQ is asserted for Ambient Light Sensor"""
        status = self.read(ALS_STATUS)
        if status & ALS_STATUS_INTERRUPT_PENDING:
            return True
        else:
            return False

    def disable_interrupt(self):
        activate_needed = False
        if self.contr_shadow & ALS_ACTIVE_MODE:
            activate_needed = True
            self.go_standby()
        self.interrupt_shadow &= ~ALS_INTERRUPT_ENABLE
        self.write(ALS_INTERRUPT, self.interrupt_shadow)
        if activate_needed:
            self.go_active()

    def set_threshold(self, first_register, threshold):
        self.cmd2databuf[0] = first_register
        self.cmd2databuf[1] = threshold & 0xFF
        self.cmd2databuf[2] = threshold >> 8

        self.i2c.try_lock()
        self.i2c.writeto(ALS_ADDR, self.cmd2databuf)
        self.i2c.unlock()

    def set_upper_threshold(self, threshold):
        self.upper_threshold = threshold
        self.set_threshold(ALS_THRES_UP_0, threshold)

    def set_lower_threshold(self, threshold):
        self.lower_threshold = threshold
        self.set_threshold(ALS_THRES_LOW_0, threshold)

    # Data needs to be read from the chip as a group
    # That is why there is only a single routine.
    def read_channels(self):
        """Return a tuple of ADC values (CH1, CH0)"""
        status = 0
        while (status & ALS_STATUS_NEW_DATA) == 0:
            status = self.read(ALS_STATUS)
            #print("Status=%02X" % (status,))

        """Read internal register"""
        self.cmdbuf[0] = ALS_DATA_CH1_0
        self.i2c.try_lock()
        self.i2c.writeto(ALS_ADDR, self.cmdbuf)

        self.i2c.readfrom_into(ALS_ADDR, self.databuf)
        self.i2c.unlock()

        channel1 = self.databuf[1] << 8
        channel1 |= self.databuf[0]

        channel0 = self.databuf[3] << 8
        channel0 |= self.databuf[2]

        # Putting the data in this order because the chip does
        return (channel1, channel0)
