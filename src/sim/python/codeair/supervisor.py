# CircuitPython's supervisor, for the simulated CodeAIR: what the embedded
# data pipe asks of it.


class _Runtime:
    serial_bytes_available = 0
    serial_connected = True


runtime = _Runtime()


def reload():
    raise KeyboardInterrupt
