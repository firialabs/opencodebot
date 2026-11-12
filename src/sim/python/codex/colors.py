"""Predefined "standard colors" and helper functions.

   Colors are defined as (RED, GREEN, BLUE) tuples. Feel free to define your own!
"""

# Utility functions for manipulating colors
def to565(r,g,b):
    """Convert 888 RGB (24 bits) to 565 (16 bits)
       Note: The CodeX LCD uses 16-bit colors natively!
    """
    return (r&0xF8,g&0xFC,b&0xF8) 

def color16(color24):
    """Convert a 24-bit RGB tuple to a 16-bit native LCD color tuple."""
    return to565(*color24)

def rgb_to_int(rgb):
    """Convert RGB tuple to an integer."""
    return (rgb[0]<<16) | (rgb[1]<<8) | (rgb[2])

def int_to_rgb(h):
    """Convert integer to RGB tuple"""
    r = (h>>16) & 255
    g = (h>>8) & 255
    b = h & 255
    return (r,g,b)

def scale_rgb(val, pcnt=100):
    """Scale RGB tuple elements by given percentage (bright/dim)"""
    return tuple(int(i * pcnt / 100) for i in val)

# Color constants 24-bit (R, G, B)
BLACK =      (0x00,0x00,0x00)  #:
WHITE =      (0xFF,0xFF,0xFF)  #:
RED =        (0xFF,0x00,0x00)  #:
GREEN =      (0x00,0xFF,0x00)  #:    
BLUE =       (0x00,0x00,0xFF)  #:       
YELLOW =     (0xFF,0xFF,0x00)  #:       
CYAN =       (0x00,0xFF,0xFF)  #:         
MAGENTA =    (0xFF,0x00,0xFF)  #:      
BROWN =      (0x6F,0x4E,0x37)  #:        
PINK =       (0xFF,0x14,0x93)  #:         
LIGHT_GRAY = (0xD3,0xD3,0xD3)  #:  
GRAY =       (0x60,0x60,0x60)  #:        
ORANGE =     (0xFF,0xA5,0x00)  #:      
DARK_GREEN = (0x22,0x8B,0x22)  #:  
DARK_BLUE =  (0x00,0x00,0x8B)  #:   
PURPLE =     (0x6A,0x0D,0xAD)  #: 
TRANSPARENT = (0xF7,0xFB,0xF7)  #:

# Color Collections
#:
COLORS_BY_NAME = {
    'BLACK' : BLACK,
    'WHITE' : WHITE,
    'RED' : RED,
    'GREEN' : GREEN,      
    'BLUE' : BLUE,     
    'YELLOW' : YELLOW,       
    'CYAN' : CYAN,        
    'MAGENTA' : MAGENTA,     
    'BROWN' : BROWN,    
    'PINK' : PINK,         
    'LIGHT_GRAY' : LIGHT_GRAY,  
    'GRAY' : GRAY,        
    'ORANGE' : ORANGE,      
    'DARK_GREEN' : DARK_GREEN,
    'DARK_BLUE' : DARK_BLUE, 
    'PURPLE' : PURPLE,
    'TRANSPARENT' : TRANSPARENT,
}

# List the predefined colors. First 10 are in order of the Resistor Color Code.
#:
COLOR_LIST = (
    BLACK, BROWN, RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE, GRAY, WHITE, CYAN, MAGENTA, PINK, LIGHT_GRAY, DARK_GREEN, DARK_BLUE,
)
