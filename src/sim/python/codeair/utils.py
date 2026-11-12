"""General purpose utility functions"""

class BytesIO_ReadOnly:
    """Wrap a bytes object as file-like stream similar to io.BytesIO() but without copying."""
    def __init__(self, data):
        self.data = data
        self.position = 0
    
    def read(self, size=-1):
        if size == -1:  # Read until the end
            size = len(self.data) - self.position
        start = self.position
        self.position = min(self.position + size, len(self.data))
        return self.data[start:self.position]
    
    def seek(self, position):
        self.position = max(0, min(position, len(self.data)))
    
    def tell(self):
        return self.position
    
    def close(self):
        pass
    
    # Context management methods for use in a `with` statement
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
