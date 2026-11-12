# Driver for tca9535 I2C I/O Expander

# The original "Python only" implementation has been enhanced
# with some C code. To maintain a "single source of truth" we
# now have to delegate to the C code
from codex_drivers import io_exp_outp_state # see write()


# Command Bytes
CMD_IN_P0 = 0   # read actual pin value (input or output)
CMD_IN_P1 = 1
CMD_OUT_P0 = 2  # mask 0=low, 1=high(def)
CMD_OUT_P1 = 3
CMD_INV_P0 = 4  # mask 0=noninvert(def), 1=invert
CMD_INV_P1 = 5
CMD_CFG_P0 = 6  # mask 0=output, 1=input(def)
CMD_CFG_P1 = 7

rd_cmds = (bytes([CMD_IN_P0]), bytes([CMD_IN_P1]))
wr_cmds = (bytearray([CMD_OUT_P0, 0]), bytearray([CMD_OUT_P1, 0]))
cfg_cmds = (bytearray([CMD_CFG_P0, 0]), bytearray([CMD_CFG_P1, 0]))


class TCA9535():
    """ Driver for tca9535 I2C I/O Expander"""
    
    def __init__(self, i2c, address):
        self.i2c = i2c
        self.addr = address
        self.resultbuf = bytearray(1)

    def read(self, port):
        """Read 8-bit pin bitmask"""
        self.i2c.try_lock()
        self.i2c.writeto(self.addr, rd_cmds[port])

        self.i2c.readfrom_into(self.addr, self.resultbuf)
        val = self.resultbuf[0]

        self.i2c.unlock()
        return val

    def write(self, port, val):
        """Write 8-bit output pin bitmask"""
        cmd = wr_cmds[port]
        cmd[1] = val
        self.i2c.try_lock()
        #self.i2c.writeto(self.addr, cmd) # Original Python code
        io_exp_outp_state(val) # Replacement C code
        self.i2c.unlock()

    def config(self, port, val):
        """Write 8-bit config bitmask: 0=output, 1=input"""
        cmd = cfg_cmds[port]
        cmd[1] = val
        self.i2c.try_lock()
        self.i2c.writeto(self.addr, cmd)
        self.i2c.unlock()

    def read_config(self, port):
        """Read 8-bit config bitmask"""
        self.i2c.try_lock()
        self.i2c.writeto(self.addr, cfg_cmds[port][:1])

        self.i2c.readfrom_into(self.addr, self.resultbuf)
        val = self.resultbuf[0]

        self.i2c.unlock()
        return val

    def read_output_latch(self, port):
        """Read 8-bit output bitmask"""
        self.i2c.try_lock()
        self.i2c.writeto(self.addr, wr_cmds[port][:1])

        self.i2c.readfrom_into(self.addr, self.resultbuf)
        val = self.resultbuf[0]

        self.i2c.unlock()
        return val
