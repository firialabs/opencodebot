"""Event-driven Services for CodeBot.

The module provides the `BotServices` object, which lets you connect callback functions
to react to events.

Example of hooking a callback function::

    from botservices import BotServices
    bot = BotServices()

    # Define callback function
    def handle_button(buttons):
        if buttons[0]:
            # Do something amazing when BTN-0 is pressed!

    # Hook the callback.
    bot.on_button(handle_button)
"""
import botcore
from cb3_drivers import runtime_us
from microcontroller import delay_us

# Bring some funcs local for speed
check_lines = botcore.ls.check
check_buttons = botcore.buttons.was_pressed
check_prox = botcore.prox.detect


def ms_tick():
    return runtime_us() // 1000


class BotServices:
    """CodeBot *event loop* built on :mod:`botcore` module.

    Todo:
      * Traverse _copy_ of callback lists, to enable safely hooking from within cb().
      * Add a param to on_xx() to allow remove cb from list.
      * Add config of prox settings.
    """

    def __init__(self):
        self.tmr_ev_list = []

        self.last_buttons = check_buttons()
        self.last_lines = check_lines()
        self.last_prox = check_prox()
        self.accel_int = None  # is set to axes[] on interrupt

        self.cb_button = []
        self.cb_line = []
        self.cb_prox = []
        self.cb_accel = []
        self.do_run = True

        self.prox_pwr = 2
        self.prox_sens = 100
        self.ls_thresh = 1000
        self.ls_reflective_line = False

        self.stat_poll = 0   # Useful for performance benchmarking
        self.start = ms_tick()

    def loop(self):
        """Enter event loop. Call this after registering 'on_EVENT' event callback functions."""
        while self.do_run:
            self.poll()

    def stop(self):
        """Exit the event loop."""
        self.do_run = False

    # --- Register event callbacks ---
    def on_button(self, cb):
        """Attach callback to Button Press events.

        Args:
            cb : Callback *function* to be called when event happens. The function will be called with a single parameter, a `list` of 2 bools.
        """
        self.cb_button.append(cb)

    def on_prox(self, cb):
        """Attach callback to Proximity Sensor events.

        Args:
            cb : Callback *function* to be called when event happens. The function will be called with a single parameter, a `list` of 2 bools.
        """
        self.cb_prox.append(cb)

    def on_line(self, cb):
        """Attach callback to Line Sensor events.

        Args:
            cb : Callback *function* to be called when event happens. The function will be called with a single parameter, a `list` of 5 bools.
        """
        self.cb_line.append(cb)

    def on_accel(self, cb):
        """Attach callback to Accelerometer events.

        Args:
            cb : Callback *function* to be called when event happens. The function will be called with a single parameter,
                 a `list` of 3 bools corresponding to X, Y, Z axes of acceleration.
        """
        pass  # TODO: Implement accelerometer
        # if not self.cb_accel:
        #     botcore.accel.enable_int1(cb=self.handle_accel_irq)
        # self.cb_accel.append(cb)

    def on_timeout(self, cb, timeout_ms, arg=None):
        """Schedule callback to occur after specified timeout.

        Args:
            cb: Callback *function* to be called after time period expires. **Note:** For a repeating timer, the callback function can
                use this function to *re-register* itself.
            timeout_ms (int): Timeout in milliseconds, after which *callback* will be called.
            arg: Optional argument that will be passed to callback function ``cb(arg)``.
        """
        self.tmr_ev_list.append((cb, timeout_ms, ms_tick(), arg))

    # ---
    def clear_last(self):
        """Clear last-value for all sensors, forcing event callbacks on next poll with new current values"""
        self.last_buttons = None
        self.last_lines = None
        self.last_prox = None

    def config_prox(self, power, sensitivity):
        """Configure proximity sensors.

        Args:
            power (int): Emitter power (1-8).
            sensitivity (int): Sensor sensitivity (0-100). Percent range from 0=least to 100=most sensitive.
        """
        self.prox_pwr = power
        self.prox_sens = sensitivity

    def config_ls(self, thresh, reflective_line):
        """Configure line sensors.

        Args:
            thresh (int): Sensor level for boundary between line and background. Sensor range is 0 (bright) to 4095 (dark).
            reflective_line (bool): Set to True for a bright line on dark background, False for dark line against light background.
        """
        self.ls_thresh = thresh
        self.ls_reflective_line = reflective_line

    # def handle_accel_irq(self, axes):
    #     self.accel_int = axes

    def poll(self):
        self.stat_poll += 1

        # Check buttons
        new_buttons = check_buttons()
        if new_buttons != self.last_buttons:
            for cb in self.cb_button:
                cb(new_buttons)

            self.last_buttons = new_buttons

        # Check line sensors
        if self.cb_line:
            new_lines = check_lines(self.ls_thresh, self.ls_reflective_line)
            if new_lines != self.last_lines:
                for cb in self.cb_line:
                    cb(new_lines)
                self.last_lines = new_lines

        # Check prox sensors
        if self.cb_prox:
            new_prox = check_prox(self.prox_pwr, self.prox_sens)
            if new_prox != self.last_prox:
                for cb in self.cb_prox:
                    cb(new_prox)
                self.last_prox = new_prox

        # Check accelerometer
        # if self.accel_int:
        #     for cb in self.cb_accel:
        #         cb(self.accel_int)
        #     self.accel_int = None

        # Check scheduled events
        # Traverse event list, filter/fire timeout events.
        cb_list = []
        rem_list = []
        for ev in self.tmr_ev_list:
            (cb, timeout, start, arg) = ev
            if ms_tick() - start >= timeout:
                cb_list.append((cb, arg))
            else:
                rem_list.append(ev)

        self.tmr_ev_list = rem_list
        for cb, arg in cb_list:
            if arg is not None:
                cb(arg)
            else:
                cb()


class CancelableCallback:
    """Wrapper for callbacks you'd like to be able to cancel.

    Example::

        cb = CancelableCallback(my_event)
        bot.on_timeout(cb, 1000)
        ...
        cb.cancel()

    """

    def __init__(self, cb):
        self.cb = cb

    def __call__(self, *args):
        self.cb(*args)

    def _nop(self, *args):
        pass

    def cancel(self):
        """Cancel this callback.

        *Note: callback remains on event list, just does nothing when called.*
        """
        self.cb = self._nop


class TestBotSvc:
    # Simple test class to check out BotServices operation.
    def __init__(self, botservices):
        self.user_led_pos = 0
        self.svc = botservices
        self.svc.on_line(self.handle_line)
        self.svc.on_prox(self.handle_prox)
        self.svc.on_button(self.handle_button)
        self.handle_tick100ms()
        self.svc.clear_last()

        # Pulse the USB LED and say hello at startup
        botcore.leds.usb(True)
        self.svc.on_timeout(botcore.leds.usb, 1000, arg=False)
        self.say_hello()

    def say_hello(self):
        for i in range(300, 1500):
            botcore.spkr.pitch(i)
            delay_us(10)
        delay_us(10000)
        botcore.spkr.off()
        delay_us(50000)
        for i in range(1500, 1000, -1):
            botcore.spkr.pitch(i)
            delay_us(10)
        delay_us(20000)
        botcore.spkr.off()

    def handle_line(self, sensors):
        """A line sensor has changed!"""
        botcore.leds.ls(sensors)

    def handle_prox(self, sensors):
        """A prox sensor has changed!"""
        botcore.leds.prox(sensors)

    def handle_button(self, buttons):
        if buttons[0] or buttons[1]:
            self.svc.stop()

    def handle_tick100ms(self):
        botcore.leds.user(1 << self.user_led_pos)
        self.user_led_pos = (self.user_led_pos + 1) % 8
        self.svc.on_timeout(self.handle_tick100ms, 100)


if __name__ == '__main__':
    # Run tests when run standalone: >>> execfile('botservices.py')
    svc = BotServices()
    test = TestBotSvc(svc)

    print("Entering event loop")
    svc.loop()
    print("Program ended.")
