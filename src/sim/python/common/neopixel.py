# Adafruit's neopixel, for the simulated boards: each pixel's colour goes to
# the simulator as the strip would show it.
import _sim


class NeoPixel:
    def __init__(self, pin, n, *, bpp=3, brightness=1.0, auto_write=True, pixel_order=None):
        self.n = n
        self._px = [(0, 0, 0)] * n
        self.brightness = brightness
        self.auto_write = auto_write

    def __len__(self):
        return self.n

    def __setitem__(self, i, color):
        if isinstance(color, int):
            color = ((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
        r, g, b = color[0], color[1], color[2]
        for c in (r, g, b):
            if not 0 <= c <= 255:
                raise ValueError("color components must be 0-255")
        self._px[i] = (int(r), int(g), int(b))
        if self.auto_write:
            self.show()

    def __getitem__(self, i):
        return self._px[i]

    def fill(self, color):
        aw = self.auto_write
        self.auto_write = False
        for i in range(self.n):
            self[i] = color
        self.auto_write = aw
        if aw:
            self.show()

    def show(self):
        b = self.brightness
        _sim.pixels(",".join("{},{},{}".format(int(r * b), int(g * b), int(bl * b)) for r, g, bl in self._px))

    def deinit(self):
        pass
