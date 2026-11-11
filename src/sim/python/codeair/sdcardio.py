# CircuitPython's sdcardio, for the simulated CodeAIR: no card in the slot.


class SDCard:
    def __init__(self, spi, cs, baudrate=8000000):
        raise OSError("no SD card")
