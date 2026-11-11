import tca9535
import board
import digitalio
from codex_drivers import io_exp_en_irq


class IOExpander():
    """Access to the CodeX IO Expander"""

    TCA9535_ADDR = 0x24  # IO Expander

    def __init__(self):
        """Initialize the IO Expander and output cache.

        The CodeX uses port 0 as all outputs. Port 1 is all inputs.
        The outputs are cached here to reduce needless i2c operations.
        """
        self.i2c = board.I2C()
        self.flush_i2c()
        self.io_exp = tca9535.TCA9535(self.i2c, IOExpander.TCA9535_ADDR)
        self.io_exp.write(0, 0)
        self.io_exp.write(1, 0)
        self.io_exp.config(0, 0x00)  # all outputs
        self.io_exp.config(1, 0xFF)  # all inputs
        self._cached_outputs = 0

        # Okay, BTN_0 is not tied to the IO Expander... But the codex_drivers interrupt-handling module
        # helpfully re-maps it as a bit in the 'codex_pins' status. Basically BTN_0 is the Expander's adopted child ;-)
        self._btn_0 = digitalio.DigitalInOut(board.IO0)
        self._btn_0.pull = digitalio.Pull.UP

        # Enable interrupts for both the Expander's IRQ output and BTN_0.
        # Use codex_drivers.io_exp_inp_state() for direct access to input states updated by ISRs
        self.irq_pin = digitalio.DigitalInOut(board.IO21)
        io_exp_en_irq()

    def flush_i2c(self):
        self.i2c.try_lock()
        for i in range(2):
            try:
                self.i2c.writeto(0, bytes([0]))
            except:
                pass
        self.i2c.unlock()

    def get_inputs(self):
        val = self.io_exp.read(1)
        return val

    def get_input(self, bit_num):
        return bool(self.io_exp.read(1) & (1 << bit_num))

    def set_outputs(self, val, use_cache=True):
        if use_cache and val == self._cached_outputs:
            return
        self.io_exp.write(0, val)
        self._cached_outputs = val

    def get_outputs(self):
        return self._cached_outputs
