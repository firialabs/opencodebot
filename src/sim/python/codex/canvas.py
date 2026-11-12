# CodeX's C module canvas, for the simulator: a Bitmap with a position and
# children, composited by the simulator (src/sim/world/gfx.js).
import _sim
import colors
from bitmap import Bitmap, _c


class Canvas(Bitmap):
    def __init__(self, width, height, x=0, y=0, scale=1, transparent_color=colors.TRANSPARENT):
        super().__init__(width, height, transparent_color, True, x, y, scale)
        self._x = int(x)
        self._y = int(y)
        self._children = []

    @property
    def x(self):
        return self._x

    @x.setter
    def x(self, v):
        self.set_position(v, self._y)

    @property
    def y(self):
        return self._y

    @y.setter
    def y(self, v):
        self.set_position(self._x, v)

    def set_position(self, x, y):
        self._x, self._y = int(x), int(y)
        _sim.gfx_move(self._h, self._x, self._y)

    def add_child(self, child, position=-1):
        if position < 0:
            self._children.append(child)
        else:
            self._children.insert(position, child)
        _sim.gfx_children(self._h, ",".join(str(c._h) for c in self._children))

    def remove_child(self, child):
        self._children.remove(child)
        _sim.gfx_children(self._h, ",".join(str(c._h) for c in self._children))

    def remove_all_children(self):
        self._children = []
        _sim.gfx_children(self._h, "")

    def show(self, obj):
        if isinstance(obj, Bitmap):
            _sim.gfx_show_image(self._h, obj._h)
        elif isinstance(obj, str):
            _sim.gfx_show_text(self._h, obj)
        else:
            raise TypeError("show() takes a str or an image")

    def print(self, obj, color=colors.WHITE, cursor_x=None, cursor_y=None, scale=2, end="\n", background=colors.BLACK):
        if isinstance(obj, Bitmap):
            self.draw_image(obj)
            return
        _sim.gfx_print(self._h, str(obj) + end, _c(color),
                       -1 if cursor_x is None else int(cursor_x), -1 if cursor_y is None else int(cursor_y),
                       int(scale), -1 if background is None else _c(background))
