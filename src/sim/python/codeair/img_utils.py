# CodeAIR's C module img_utils, for the simulator.


def get_bitmap_bytes(bitmap):
    return memoryview(bytearray(bitmap.width * bitmap.height * 2))


def save_bitmap_file(bitmap, filename):
    raise OSError("no SD card")
