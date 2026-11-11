"""
This module allows you to define simple images with ascii art instead of 
using a bitmap editor tool and working with binary file resources.

For example:

|  images = \'\'\'
|  /.=(0,0,0) #=(255,255,255) %=(255,0,0)
|  ..#..
|  .#.#. 
|  #...# 
|  ..%.. 
|  ..%..
|  \'\'\'

The first line starting with "/" maps ascii art characters to colors. In this
case the '.' becomes BLACK, '#' becomes WHITE, and '%' becomes RED. You can also 
use the color constant names from the 'colors' module instead of the RGB tuple.

The lines that follow define a simple 5x5 pixel image that can be copied into 
a window for a background or used as the image of a sprite.

Here is a complex example demonstrating all the art features:

|  images = \'\'\'
|  /.=TRANSPARENT #=WHITE %=RED
|  ..#.. | /0y..
|  .#.#. | .....
|  #...# | .....
|  ..%.. | .....
|  ..%.. | .....
|  _____________
|  /%=GREEN
|  ..#.. | /0x..
|  .#... | .....
|  #..%% | .....
|  .#... | .....
|  ..#.. | .....
|  \'\'\'

Multiple images can be drawn in the same ascii art string. Images on a row are separated
by a space ' '. Rows of images are separated by a blank line. The '|' and '_' characters
are optional; they are ignored. You can use them for added visual separation.

Rows of images do not have to be the same length as they are here. One row can have more
images than another row.

All the images on a single row must be the same width and height. Different rows can be
different width/height.

The first line of each row can change the color mapping. The new values remain in effect
on future rows unless changed by a later row. In this example, the '%' is mapped to GREEN 
in all images on the second row.

If the upper left corner of an image is '/', then the image is a mirror of another image.
On the first row, the second image begins with '/0y'. This indicates that the image
is a copy of image '0' on that row (the first image on the row) but is mirrored on the Y axis.

The second image on the second row is a copy of image 0 (the first) image on that row but
mirrored on the X axis.

You can mirror both directions at once. For instance '/0xy'.

"""

from bitmap import Bitmap
import colors


def _hex_bin(val):
    val = val.strip()
    if val.startswith('0x'):
        return int(val[2:], 16)
    return int(val)


def _decode_art(text, color_map=None):
    '''Convert a sheet of ascii art images into a list of Bitmaps

    Args:
        text (str): The ascii-art string.
        color_map (dict, optional): Mapping of characters to colors

    Returns:
        list: The created Bitmap objects.
    '''
    # TODO better error checking and reporting

    # Remove all "_" and "|". They are just for viewing
    text = text.replace('_', ' ')
    text = text.replace('|', ' ')

    # Split by lines and trim off leading/trailing spaces
    lines = text.split('\n')
    while not lines[0].strip():
        lines = lines[1:]
    while not lines[-1].strip():
        lines = lines[:-1]

    # Separate the lines into rows of images
    image_rows = [[]]
    for line in lines:
        line = line.strip()
        if line:
            image_rows[-1].append(line)
        else:
            if image_rows[-1]:
                # This ignores multiple blank lines
                image_rows.append([])

    # We migh start with a given character mapping
    if not color_map:
        color_map = {}

    images = []
    image_row_map_chars = []

    # By default, '.' maps to transparent and '#' to white
    cmap = {
        '.': colors.TRANSPARENT,
        '#': (255, 255, 255)
    }

    for image_row in image_rows:
        while image_row[0].startswith('/'):
            desc = image_row[0]
            desc = desc[1:].split()
            image_row = image_row[1:]
            for e in desc:
                if e[1] != '=':
                    raise Exception('Invalid character mapping "'+str(e)+'"')
                try:
                    if e[2] == '(':
                        # This is an absolute tuple
                        r, g, b = e[3:-1].split(',')
                        r = _hex_bin(r)
                        g = _hex_bin(g)
                        b = _hex_bin(b)
                        cmap[e[0]] = (r, g, b)
                    else:
                        # This is a constant from colors
                        cmap[e[0]] = colors.COLORS_BY_NAME[e[2:].strip()]
                except Exception:
                    raise Exception('Invalid character mapping "'+str(e)+'"')

        # The passed-in map gets priority
        # cmap = {**cmap, **color_map} -- not in micropython
        for k, v in color_map.items():
            cmap[k] = v
            # cmap[ord(k)] = v

        # This rows color mapping (used later when we build the grids)
        image_row_map_chars.append(cmap)

        # Build the 2D array of images from the row of images
        ir = []
        image_width = 0
        num_cols = 0
        for row in image_row:
            # Process the image columns on the row

            # Remove repeated whitespace
            #row = ' '.join(row.split())

            image_cols = row.split()
            if num_cols:
                if len(image_cols) != num_cols:
                    raise Exception('All images on a row must be the same height: '+row)
            else:
                num_cols = len(image_cols)
                for i in range(num_cols):
                    ir.append([])

            for i in range(num_cols):
                col = image_cols[i]
                if image_width:
                    if image_width != len(col):
                        raise Exception('All images on a row must be the same width: '+row)
                else:
                    image_width = len(col)

                ir[i].append(col)

        images.append(ir)

    # Handle mirroring, rotation, etc
    for row_num in range(len(images)):
        row = images[row_num]
        for col_num in range(len(row)):
            im = row[col_num]
            if im[0].startswith('/'):
                # These are special operators to reuse existing images on the row
                col = im[0][1:].replace('.', ' ').strip()
                mx = False
                my = False
                tg = 0
                for c in col.upper():
                    if c == 'X':
                        mx = True
                    elif c == 'Y':
                        my = True
                    else:
                        try:
                            tg = tg * 10 + int(c)
                        except Exception:
                            raise Exception('Invalid mirroring character: '+c)
                # This is the target image on the row to mirror
                if tg >= col_num:
                    raise Exception('Invalid image target: '+str(tg))
                tg = row[tg]
                if my:
                    l = len(tg)-1
                    for j in range(len(tg)-1, -1, -1):
                        if mx:
                            row[col_num][l-j] = ''.join(reversed(tg[j]))
                        else:
                            row[col_num][l-j] = tg[j]
                else:
                    for j in range(len(tg)):
                        if mx:
                            row[col_num][j] = ''.join(reversed(tg[j]))
                        else:
                            row[col_num][j] = tg[j]

    return (images, image_row_map_chars)


def get_images(text, transparent_color=colors.TRANSPARENT, scale=1, color_map=None):
    '''Convert a sheet of ascii art images into a list of Bitmaps

    Args
        text (str): The ascii-art string.        
        transparent_color (tuple, optional): The color value to treat as transparent. Default is colors.TRANSPARENT.
        scale (int): Pixel scaling factor
        color_map (dict, optional): Mapping of characters to colors

    Returns:
        list: The created Bitmap objects.
    '''
    images, image_row_map_chars = _decode_art(text, color_map)

    ret = []
    for row_num in range(len(images)):
        row = images[row_num]
        map_chars = image_row_map_chars[row_num]
        for col in row:
            bm = Bitmap.from_ascii(col, transparent_color, scale, map_chars)
            ret.append(bm)

    return ret
