# CodeX's C module tft, for the simulator: the panel, its two root canvases
# and its backlight.
import _sim
from canvas import Canvas


class TFT:
    def __init__(self, auto_update=True, transparent_color=(0, 0, 0), backlight_pwm=None):
        self._display = Canvas(240, 240, transparent_color=None)
        self._console = Canvas(240, 240, transparent_color=transparent_color)
        self._console.clear()
        _sim.gfx_roots(self._display._h, self._console._h)
        self._backlight = backlight_pwm
        self.auto_update = auto_update
        self.brightness = 80

    @property
    def display(self):
        return self._display

    @display.setter
    def display(self, c):
        self._display = c
        _sim.gfx_roots(self._display._h, self._console._h)

    @property
    def console(self):
        return self._console

    @console.setter
    def console(self, c):
        self._console = c
        _sim.gfx_roots(self._display._h, self._console._h)

    @property
    def auto_update(self):
        return self._auto

    @auto_update.setter
    def auto_update(self, on):
        self._auto = bool(on)
        _sim.gfx_auto(1 if on else 0)

    def update(self):
        _sim.gfx_update()

    @property
    def brightness(self):
        return self._brightness

    @brightness.setter
    def brightness(self, pct):
        if not 0 <= pct <= 100:
            raise ValueError("brightness must be 0-100")
        self._brightness = int(pct)
        if self._backlight is not None:
            self._backlight.duty_cycle = int(pct * 65535 / 100)
