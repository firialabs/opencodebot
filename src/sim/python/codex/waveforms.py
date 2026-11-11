""" Provides functions to make 16-bit buffers suitable for playing audio on CodeX.

Each of the make_X functions returns a new `array` ('h') of the requested length (default 240)
that contains 16-bit numbers forming the corresponding wave shape:

    * sine
    * square
    * sawtooth
    * triangle
    * random
"""

import array
import math
import random

def make_sine(max_amplitude=32767, length=240):
    """Generate a single cycle of a sine wave with the requested amplitude and length (resolution)"""
    sine_wave = array.array("h", [0] * length)
    for i in range(length):
        sine_wave[i] = int(math.sin(math.pi * 2 * i / length) * max_amplitude)
    return sine_wave

def make_square(max_amplitude=32767, length=240):
    """Generate a single cycle of a square wave with the requested amplitude and length (resolution)"""
    square_wave = array.array("h", [0] * length)
    for i in range(length):
        fract_period = i / length
        amplitude = max_amplitude if fract_period > 0.5 else -max_amplitude
        square_wave[i] = amplitude
    return square_wave

def make_sawtooth(max_amplitude=32767, length=240):
    """Generate a single cycle of a sawtooth wave with the requested amplitude and length (resolution)"""
    sawtooth_wave = array.array("h", [0] * length)
    for i in range(length):
        fract_period = i / length
        amplitude = max_amplitude * (fract_period * 2 - 1)
        sawtooth_wave[i] = round(amplitude)
    return sawtooth_wave

def make_triangle(max_amplitude=32767, length=240):
    """Generate a single cycle of a triangle wave with the requested amplitude and length (resolution)"""
    triangle_wave = array.array("h", [0] * length)
    for i in range(length):
        fract_period = i / length
        if fract_period < 0.5:
            amplitude = fract_period * 2 * (2 * max_amplitude) - max_amplitude
        else:
            amplitude = (1 - fract_period) * 2 * (2 * max_amplitude) - max_amplitude
        
        triangle_wave[i] = round(amplitude)
    return triangle_wave

def make_random(max_amplitude=32767, length=240):
    """Generate a single cycle of a random wave with the requested amplitude and length (resolution)"""
    random_wave = array.array("h", [0] * length)
    for i in range(length):
        amplitude = random.randrange(-max_amplitude, max_amplitude)
        random_wave[i] = amplitude
    return random_wave
