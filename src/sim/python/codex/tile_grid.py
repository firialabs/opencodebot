import canvas
import colors

class TileGrid(canvas.Canvas):
    """A grid of image tiles.

    This object breaks its display area into a number of bitmap tiles. The user
    changes the display by changing the tile numbers for each cell in the grid.
    """

    def __init__(self, tiles, map_width, map_height, x=0, y=0, transparent_color=colors.TRANSPARENT, initial_index=0, scale=1):
        """Create a new TileGrid.

        Args:
            tiles (list[Bitmap]): The tile pictures available in the grid.
            map_width (int): The number of tiles across the grid.
            map_height (int): The number of tiles down the grid.
            x (int, optional): The x coordinate relative to the parent object. Defaults to 0.
            y (int, optional): The y coordinate relative to the parent object. Defaults to 0.
            transparent_color (tuple, optional): The RGB clear-color value. Defaults to colors.TRANSPARENT.            
            initial_index (int, optional): The tile to show in each cell on creation. Default is 0.
            scale (int): Scale factor for all tiles.
        """        
        self._tile_width = tiles[0].width * scale
        self._tile_height = tiles[0].height * scale
        self._map_height = map_height
        self._map_width = map_width
        self._tiles = tiles
        self._map = []
        self._transparent_color = transparent_color
        self._scale = scale

        super().__init__( 
                        width=self._tile_width * map_width,
                        height=self._tile_height * map_height, 
                        x=x, y=y, 
                        transparent_color=transparent_color)

        for h in range(map_height):
            self._map.append([])
            for w in range(map_width):
                self._map[-1].append(initial_index)
                self.set_tile_index(x=w,y=h,index=initial_index)
    
    def set_tile_image(self, index, image):
        """Change the tile image at the given tile index.

        Args:
            index (int): The tile index.
            image (Bitmap): The new image.        
        """
        self._tiles[index] = image

    def get_tile_index(self, x=0, y=0):
        """Return the tile number in the given cell.

        Args:
            x (int, optional): The column number of the tile. Defaults to 0 (first column).
            y (int, optional): The row number of the tile. Defaults to 0 (first row).
        """
        return self._map[y][x]

    def set_tile_index(self, x=0, y=0, index=0) -> None:
        """Set the tile number in the given cell.

        Args:
            x (int, optional): The column number of the tile. Defaults to 0 (first column).
            y (int, optional): The row number of the tile. Defaults to 0 (first row).
            index (int, optional): The tile index number. Defaults to 0 (first image).
        """
        if self._transparent_color is not None:
            self.fill_rect(x * self._tile_width, y * self._tile_height, self._tile_width, self._tile_height, colors.TRANSPARENT)

        self.draw_image(self._tiles[index], x=x*self._tile_width, y=y*self._tile_height, scale=self._scale)
        self._map[y][x] = index