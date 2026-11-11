# CodeAIR's C module codeair_drivers, for the simulator: the same names, over
# the simulated board.
import _sim
import sys


def version():
    return 1


def enable_btn_isr():
    _sim.btn_was_pressed(0)
    _sim.btn_was_pressed(1)


def btn_was_pressed(num):
    return bool(_sim.btn_was_pressed(num))


def runtime_us():
    return _sim.runtime_us()


def console_bytes(data):
    if isinstance(data, str):
        data = data.encode()
    sys.stdout.write(bytes(data).decode("latin-1"))


def crc32(init_crc, buffer):
    crc = (~init_crc) & 0xFFFFFFFF
    for b in buffer:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ (0xEDB88320 if crc & 1 else 0)
    return (~crc) & 0xFFFFFFFF


def sys_info():
    print("CodeAIR (simulated)")


def debug_uart_out(text):
    pass


def debug_uart_in():
    return b""


def debug_uart_config(baudrate):
    pass


def cam_reset():
    pass
