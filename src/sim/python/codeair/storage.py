# CircuitPython's storage, for the simulated CodeAIR: there is no card to
# mount, so nothing here is reached.


class VfsFat:
    def __init__(self, block_device):
        self.block_device = block_device


def mount(filesystem, mount_path, *, readonly=False):
    raise OSError("no SD card")


def umount(mount):
    pass


def remount(mount_path, readonly=False, *, disable_concurrent_write_protection=False):
    pass
