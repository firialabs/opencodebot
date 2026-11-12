# CircuitPython's pulseio, over the simulated infrared (src/sim/world/infrared.js):
# what infrared.py on CodeX and CodeAIR drives. PulseOut sends a burst of
# on/off times in microseconds, taking that long; PulseIn buffers the bursts
# that reach this board's receiver.
import _sim


class PulseOut:
    def __init__(self, pin, *, frequency=38000, duty_cycle=1 << 15):
        self.frequency = frequency
        self.duty_cycle = duty_cycle

    def send(self, pulses):
        _sim.ir_send(",".join(str(p) for p in pulses))

    def deinit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class PulseIn:
    def __init__(self, pin, maxlen=2, *, idle_state=False):
        self.maxlen = maxlen
        self.idle_state = idle_state
        self._paused = False
        _sim.ir_open(maxlen)

    def __len__(self):
        return _sim.ir_len()

    def __bool__(self):
        return len(self) > 0

    def __getitem__(self, index):
        n = len(self)
        if index < 0:
            index += n
        if not 0 <= index < n:
            raise IndexError("index out of range")
        return _sim.ir_get(index)

    def popleft(self):
        if not len(self):
            raise IndexError("pop from empty")
        return _sim.ir_popleft()

    def clear(self):
        _sim.ir_clear()

    def pause(self):
        self._paused = True
        _sim.ir_pause(True)

    def resume(self, trigger_duration=0):
        self._paused = False
        _sim.ir_pause(False)

    @property
    def paused(self):
        return self._paused

    def deinit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass
