# CircuitPython's traceback, over MicroPython's sys.print_exception.
import sys
import io


def format_exception(exc, value=None, tb=None, limit=None, chain=True):
    if value is None or not isinstance(value, BaseException):
        value = exc
    s = io.StringIO()
    sys.print_exception(value, s)
    return [s.getvalue()]


def print_exception(exc, value=None, tb=None, limit=None, file=None, chain=True):
    if value is None or not isinstance(value, BaseException):
        value = exc
    sys.print_exception(value, file or sys.stdout)
