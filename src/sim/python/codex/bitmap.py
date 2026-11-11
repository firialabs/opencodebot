# CodeX's C module bitmap, for the simulator: the pixels live in the
# simulator (src/sim/world/gfx.js); this is the Python face.
import _sim
import colors


def _c(color):
    """A colour, an (r, g, b) tuple or a 24-bit int, as the panel's RGB565."""
    if isinstance(color, int):
        color = ((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
    if not isinstance(color, (tuple, list)):
        raise TypeError("Color must be a tuple")
    if len(color) != 3:
        raise ValueError("Color tuples must have 3 components")
    r, g, b = color
    return ((int(r) & 0xF8) << 8) | ((int(g) & 0xFC) << 3) | (int(b) >> 3)


def _rgb(c):
    r, g, b = (c >> 11) & 0x1F, (c >> 5) & 0x3F, c & 0x1F
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))


class Bitmap:
    def __init__(self, width, height, transparent_color=colors.TRANSPARENT, _canvas=False, x=0, y=0, scale=1):
        self._h = _sim.gfx_new(int(width), int(height), 1 if _canvas else 0, int(x), int(y), int(scale))
        self._w = int(width)
        self._ht = int(height)
        self.transparent_color = transparent_color

    @property
    def width(self):
        return self._w

    @property
    def height(self):
        return self._ht

    @property
    def transparent_color(self):
        return self._transparent

    @transparent_color.setter
    def transparent_color(self, c):
        self._transparent = c
        _sim.gfx_transparent(self._h, -1 if c is None else _c(c))

    def set_pixel(self, x, y, color):
        _sim.gfx_pixel(self._h, int(x), int(y), _c(color))

    def get_pixel(self, x, y):
        return _rgb(_sim.gfx_get_pixel(self._h, int(x), int(y)))

    def clear(self):
        _sim.gfx_clear(self._h)

    def fill(self, color):
        _sim.gfx_fill(self._h, _c(color))

    def draw_line(self, x1, y1, x2, y2, color):
        _sim.gfx_line(self._h, int(x1), int(y1), int(x2), int(y2), _c(color))

    def draw_rect(self, x1, y1, width, height, color):
        _sim.gfx_rect(self._h, int(x1), int(y1), int(width), int(height), _c(color), 0)

    def fill_rect(self, x1, y1, width, height, color):
        _sim.gfx_rect(self._h, int(x1), int(y1), int(width), int(height), _c(color), 1)

    def draw_circle(self, x, y, radius, color):
        _sim.gfx_circle(self._h, int(x), int(y), int(radius), _c(color), 0)

    def fill_circle(self, x, y, radius, color):
        _sim.gfx_circle(self._h, int(x), int(y), int(radius), _c(color), 1)

    def draw_text(self, text, x=0, y=0, color=colors.WHITE, scale=1, background=None):
        if isinstance(text, Bitmap):
            self.draw_image(text, x, y, scale=scale)
            return
        _sim.gfx_text(self._h, str(text), int(x), int(y), _c(color), int(scale), -1 if background is None else _c(background))

    def draw_image(self, bitmap, x=0, y=0, start_x=0, start_y=0, end_x=None, end_y=None, scale=1):
        _sim.gfx_image(self._h, bitmap._h, int(x), int(y), int(start_x), int(start_y),
                       -1 if end_x is None else int(end_x), -1 if end_y is None else int(end_y), int(scale))

    def draw_jpg(self, filename, start_x=0, start_y=0, x=0, y=0, width=None, height=None):
        raise OSError(2)   # no files on a simulated CodeX yet

    @staticmethod
    def from_arr(data):
        """A Bitmap from rows of colour numbers (indexes into COLOR_LIST;
        others are transparent)."""
        h = len(data)
        w = len(data[0]) if h else 0
        bmp = Bitmap(w, h)
        palette = [_c(c) for c in colors.COLOR_LIST]
        tc = _c(colors.TRANSPARENT)
        px = []
        for row in data:
            for v in row:
                px.append(palette[v] if 0 <= v < len(palette) else tc)
        _sim.gfx_load(bmp._h, "".join("{:04x}".format(p) for p in px))
        return bmp

    @staticmethod
    def from_ascii(ascii_img, transparent_color=colors.TRANSPARENT, scale=1, color_map=None):
        rows = [r for r in ascii_img]
        h = len(rows) * scale
        w = max(len(r) for r in rows) * scale if rows else 0
        bmp = Bitmap(w, h, transparent_color)
        bg = _c(transparent_color) if transparent_color is not None else 0
        cmap = {}
        if color_map:
            for k, v in color_map.items():
                cmap[k] = _c(v)
        px = []
        for r in rows:
            line = []
            for ch in r:
                line.extend([cmap.get(ch, bg)] * scale)
            line.extend([bg] * (w - len(line)))
            px.extend(line * scale)
        _sim.gfx_load(bmp._h, "".join("{:04x}".format(p) for p in px))
        return bmp
