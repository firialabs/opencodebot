"""Embedding data in console output for visualization"""

import struct
import time
from codeair_drivers import console_bytes
from img_utils import get_bitmap_bytes
import sys
import supervisor

def _check_ping_resp():
    buf = ''
    for _ in range(3):
        while supervisor.runtime.serial_bytes_available:
            b = sys.stdin.read(1)
            buf += b
            if "OK" in buf or len(buf) > 32:
                return True
        time.sleep(0.01)
    return False

class ConsoleWriter:
    """A class to adapt console_bytes to the write method like a file."""
    write = console_bytes

console_writer = ConsoleWriter()

class EmbeddedDataPipe:
    """Encode supported data types for output to selected destination.
    
    Embedded Data Protocol:
        C0DECAFE + LEN_4bytes_u32 + descriptor_16bytes + data
        -- LEN is big endian
        -- descriptor is object-dependent string (see EdataViewer.js)

    Attributes:
        destination (file): The destination for the encoded data.
        MAGIC (bytes): The magic bytes to identify the protocol.
    """

    def __init__(self):
        """Initializes the EmbeddedDataPipe and sets the default destination.
        """
        self.destination = console_writer
        self.MAGIC = b'\xc0\xde\xca\xfe'

    def connect(self, destination=None):
        """Connects to a new destination.

        Args:
            destination (file object): The new destination. Defaults to console_writer.
        """
        if destination is None:
            destination = console_writer
        
        self.destination = destination

    def ping(self):
        """Send a ping message to CodeSpace. Return True if connected and responding.
        """
        # Will reply with "OK\r" if successful.
        self.destination.write(self.MAGIC + b'\x01\x00\x00\x00')
        return _check_ping_resp()

    def chart(self, chart_name, value, series=None, chart_type="line"):
        """Send chart data. A unique chart_name will create a new chart. New series also work this way.
        
        Args:
            chart_name (str): Identifies which chart we're talking about ("temp", "sensors", etc.).
            value (float or iterable): The data to plot. Must be a single number or an iterable of (val, millisecond) points.
            series (str, optional): Optional string for labeling multiple data series in the same chart.
            chart_type (str, optional): Optional. Can support line vs. bar vs. scatter, etc. Defaults to "line".
        """
        # descriptor="chartBNAME" | B=type(0=line), NAME=chart_name(max 10 chars)
        chart_type_code = 0 if chart_type == "line" else 1  # Assuming 0=line, 1=other types
        descriptor = struct.pack('5sB10s', 'chart', chart_type_code, chart_name[:10])

        # After descriptor comes series name (null-terminated)
        if series:
            series_name = series.encode('utf-8') + b'\x00'
        else:
            series_name = b'\x00'  # default series

        # Followed by data (8-bytes per point)
        if isinstance(value, (int, float)):
            data = struct.pack('>fI', value, time.ticks_ms())  # single point, current timestamp
        elif isinstance(value, (list, tuple)):
            data = b""
            for val, timestamp in value:
                data += struct.pack('>fI', val, int(timestamp))
        else:
            raise ValueError("Invalid value type. Must be int, float, list, or tuple.")

        # Construct data packet
        pkt = self.MAGIC + struct.pack('>I16s', 16 + len(series_name) + len(data), descriptor) + series_name + data
        self.destination.write(pkt)

    def image(self, bitmap):
        """Send image to data panel.
        Only 16-bit RGB565 images are supported.

        Args:
            bitmap (Bitmap): The bitmap image to send.
        """
        # descriptor="imageBWWHH" | B=bits per pixel, WW=width16, HH=height16
        total_pixels = bitmap.width * bitmap.height

        hdr = self.MAGIC
        hdr += struct.pack('>I5sBHH6s', 16 + total_pixels * 2, "image", 16, bitmap.width, bitmap.height, "")

        bmp = get_bitmap_bytes(bitmap)
        self.destination.write(hdr)
        self.destination.write(bmp)  # Write separately to maintain zero copy

    def text(self, value):
        """Send text message to data panel. This is a simple type, used primarily for testing
        the embedded data protocol.

        Args:
            value (str): The text message to send.
        """
        hdr = self.MAGIC + struct.pack('>I16s', 16 + len(value), "text") + value
        self.destination.write(hdr)

