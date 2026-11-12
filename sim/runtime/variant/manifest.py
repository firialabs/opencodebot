# The port's own frozen modules (asyncio). The device modules are not frozen:
# the simulator loads them from src/sim/python/ at startup, so they change
# without a rebuild.
include("$(PORT_DIR)/variants/manifest.py")
