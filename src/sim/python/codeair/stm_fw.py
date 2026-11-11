# The flight controller's firmware image, which the device carries to load
# into its STM32. The simulated flight controller needs no image; this only
# names the version it runs.


def version():
    return "2024.10-codeair-sim"


def stm_fw_gz():
    raise OSError("the simulator has no flight controller image to load")
