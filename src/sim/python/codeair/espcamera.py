# CircuitPython's espcamera, for the simulated CodeAIR: the camera is there
# but sees nothing yet, so take() returns None (as the device does when no
# frame is ready).


class PixelFormat:
    RGB565 = 0
    GRAYSCALE = 1
    JPEG = 2


class FrameSize:
    R96X96 = 0
    QQVGA = 1
    QCIF = 2
    HQVGA = 3
    R240X240 = 4
    QVGA = 5
    CIF = 6
    HVGA = 7
    VGA = 8


class GrabMode:
    WHEN_EMPTY = 0
    LATEST = 1


class Camera:
    def __init__(self, *, data_pins=None, pixel_clock_pin=None, vsync_pin=None, href_pin=None,
                 i2c=None, external_clock_pin=None, external_clock_frequency=20000000,
                 powerdown_pin=None, reset_pin=None, pixel_format=PixelFormat.RGB565,
                 frame_size=FrameSize.QQVGA, jpeg_quality=15, framebuffer_count=1,
                 grab_mode=GrabMode.WHEN_EMPTY):
        self.pixel_format = pixel_format
        self.frame_size = frame_size
        self.framebuffer_count = framebuffer_count
        self.grab_mode = grab_mode

    def take(self, timeout=0.25):
        return None

    def frame_available(self):
        return False

    def deinit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.deinit()
