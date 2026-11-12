# CircuitPython's audiocore for the simulated CodeX: samples are accepted
# and timed; the simulator does not play recorded sound.


class RawSample:
    def __init__(self, buffer, *, channel_count=1, sample_rate=8000):
        self.sample_rate = sample_rate
        self._len = len(buffer)

    def deinit(self):
        pass


class WaveFile:
    def __init__(self, file, buffer=None):
        raise OSError(2)    # no files on a simulated CodeX yet
