import tile_grid
import colors

class Sprite(tile_grid.TileGrid):
    """ A sprite object with multiple pictures for animation.

    A Sprite IS a TileGrid with added motion/collision features.    

    Sprites typically move, and these objects have a deltaX and deltaY.
    Use the "move_by_deltas" function to change the X,Y position of the 
    Sprite, or you can set the position directly.

    You might want to know if Sprites have collided. For this check, each 
    Sprite is treated as a rectangle. The Sprite checks if its rectangle
    overlaps another Sprite's rectangle. Sometimes a Sprite image doesn't fill 
    the entire Sprite area. And some images of the same Sprite may have different 
    collision boxes than the others. A kneeling man, for instance, has a smaller 
    collision area than a standing one.

    Use the "set_bounding_box" to define a single box for all images or a list
    of boxes -- a different one for each image. The default bounding box is the
    entire Sprite.

    Use the "check_collision" method to use the bounding boxes and check if 
    one Sprite has collided with another.

    For example:

    |    from codex import *
    |    from sprite import Sprite
    |    import ascii_art
    |    import time
    |
    |    ims = ascii_art.get_images(\'\'\'
    |        /#=(255,255,255)
    |        #..#   ####
    |        .##.   #..#
    |        .##.   #..#
    |        #..#   ####
    |    \'\'\')
    |
    |    sp1 = Sprite(ims,x=10,y=10)
    |    display.add_child(sp1)
    |
    |    sp2 = Sprite(ims,x=12,y=12)
    |    display.add_child(sp2)
    |
    |    if sp1.check_collision(sp2):
    |        print("They overlap")
    |
    |    sp1.set_deltas(2,5)
    |    while True:
    |        sp1.move_by_deltas()
    |        time.sleep(0.25)

    """
    
    def __init__(self, tiles, x=0, y=0, transparent_color=colors.TRANSPARENT, initial_index=0):
        """ Create a new Sprite.

        Args:
            tiles (list[Bitmap]): The images available in the sprite            
            x (int, optional): The x coordinate relative to the parent object. Defaults to 0.
            y (int, optional): The y coordinate relative to the parent object. Defaults to 0.            
            transparent_color (tuple, optional): The RGB clear-color value. Defaults to None.
            initial_index (int, optional): The initial image index. Default is 0 (the first in the list).
        """

        if not isinstance(tiles,list):
            tiles = [tiles]
        
        tile_grid.TileGrid.__init__(self,tiles,1,1,x,y,transparent_color,initial_index)
        self._box = (0,0,tiles[0].width*1,tiles[0].height*1)
        self._deltas = [0,0]
    
    #
    #
    # The Sprite API
    #
    #
    
    def set_bounding_box(self,box):
        """Define the collision detection box for this sprite.

        A box is defined by 4 integers: the upper left corner X,Y and
        the lower right corner X,Y.

        You may pass in either form:

          - [1,2,3,4] a list of lists of 4 things as (X1,Y1,X2,Y2)
          - [  [1,2,3,4], [1,2,3,4] ] a list of boxes (one box per image)

        For multi-cell sprites, you must use a single bounding box.

        Params:
            box (list): Ether one box or a list of boxes (one per image)
        """        
        self._box = box                 

    def get_bounding_box(self):
        """Get the collision detection box definition.

        Returns:
            list: Either a single box or a list of boxes
        """
        return self._box

    def set_deltas(self, dx, dy):
        """Set the motion offsets used by move_by_deltas.

        Params:
            dx (int): offset in the X direction
            dy (int): offset in the Y direction
        """
        self._deltas = [dx,dy]

    def get_deltas(self):
        """Get the current motion deltas.

        Returns:
            tuple(int,int): the dx and dy values
        """
        return self.deltas

    def move_by_deltas(self):
        """Move the sprite by its current delta values.        
        """
        cur_x = self.x
        cur_y = self.y
        dx,dy = self._deltas
        self.set_position(cur_x+dx,cur_y+dy)

    def _get_box_for_visible_index(self):   
        # Returns the visible image's bounding box     
        if isinstance(self._box[0],int):
            # This is ONE box for all images
            return self._box
        else:
            # Each image has its own box
            return self._box[self.get_image_index]   

    def check_collision(self, others):
        """Check if this sprite has collided with another.

        Params:
            others (list): a single Sprite or a list of sprites

        Returns:
            list: all the input sprites that overlap this one

        """

        # TODO move this to C for performance and avoid all the method calls

        if not isinstance(others,list):
            others = [others]
        
        ret = []

        for other in others:

            b1x,b1y,b2x,b2y = self._get_box_for_visible_index()            
            x,y = self.x,self.y            
            l1x,l1y, r1x,r1y = x+b1x,y+b1y,x+b2x,y+b2y
            
            b1x,b1y,b2x,b2y = other._get_box_for_visible_index()
            x,y = other.x,other.y
            l2x,l2y, r2x,r2y = x+b1x,y+b1y,x+b2x,y+b2y
            
            if l1x>r2x or l2x>r1x:
                continue
            if l1y>r2y or l2y>r1y:
                continue

            ret.append(other)        

        return ret
