"""Interface to CodeAIR's Flight Control Computer

See also `flight_lib/flight_lib`

* fly = `MotionCommander`
* fly_high = `HighLevelCommander`
* cf_commander = `Commander`

High-level flying and sensors:
------------------------------

**Basic Hover:**

    >>> fly.take_off()  # Ascend to default altitude at default speed
    >>> fly.steady(4)   # Hold for 4 seconds
    >>> fly.land()      # Descend at default speed

Low-level control and flight parameter access:
----------------------------------------------

**Watch Flight Controller console output on bootup:**

    >>> crtp.console_stdout(True)
    >>> reset_controller()

**Get sensor data:**

    >>> get_data(RANGERS)

**Set and Get parameters (e.g., m1 speed parameter):**

    >>> set_param('motorPowerSet.m1', 5000)
    >>> get_param('motorPowerSet.m1')

"""

import board
import time
import stm32_boot
import digitalio
import flightdb
import crtp
import stm_fw
from flightdb import read_crtp, CRTP_PORT_PLATFORM
from utils import BytesIO_ReadOnly

from cflib import commander, motion_commander, crtpstack, high_level_commander

def load_fw(file=None, prog=None):
    """Load new firmware into the flight controller. By default uses Crazyflie controller firmware.
       Optional progress callback.
    """
    if file is None:
        print("Extracting default firmware image.")
        from zlib import decompress
        from stm_fw import stm_fw_gz
        bin = decompress(stm_fw_gz(), 31)
        file = BytesIO_ReadOnly(bin)
    elif type(file) == str:
        print("Updating STM32 firmware with file: ", file)

    # Release UART so we can access bootloader
    crtp.deinit()

    st = stm32_boot.STM32boot(prog)
    
    stat = st.enter_boot()
    if not stat:
        print("Error: Failed to enter bootloader.")
        return False

    ver = st.get_version()   # returns 0x31  => Version 3.1
    print("Bootloader v%s" % '.'.join(hex(ver)[2:]))

    print("Erasing...")
    stat = st.mass_erase()    # returns True after ~16 seconds
    if not stat:
        print("Error: Erase failed.")
        return False

    print("Writing...")
    stat = st.write_flash(file)  # returns True after ~34 seconds
    if not stat:
        print("Error: Write failed.")
        return False

    st.exit_boot()     # exits BOOT mode and resets STM32    
    st.deinit()
    crtp.init()  # restore CRTP control of UART
    print("Done!")
    return True

def reset_controller():
    """Reset the flight controller CPU"""
    STM_NRST = board.D33
    nrst = digitalio.DigitalInOut(STM_NRST)
    nrst.direction = digitalio.Direction.OUTPUT
    nrst.value = 0
    time.sleep(0.1)
    nrst.value = 1
    time.sleep(0.1)
    nrst.deinit()

# Instantiate database singletons
log_manager = flightdb.LogManager()
param_manager = flightdb.ParamManager(log_manager)

# Data item tuples, pass to 'get_data()' 
# Complete list here: https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/api/logs/
GYRO = ('gyro.xRaw', 'gyro.yRaw', 'gyro.zRaw',)  #:
RANGERS = ('range.front', 'range.up', 'range.zrange',) #:
FLOW = ('motion.deltaX', 'motion.deltaY',) #:
ACCEL = ('acc.x', 'acc.y', 'acc.z',) #:
MAG = ('mag.x', 'mag.y', 'mag.z',) #:
BAROMETER = ('baro.asl', 'baro.temp', 'baro.pressure',) #:
STATE_EST_POS = ('stateEstimate.x', 'stateEstimate.y', 'stateEstimate.z', 'stateEstimate.yaw') #:
STATE_EST_VEL = ('stateEstimate.vx', 'stateEstimate.vy', 'stateEstimate.vz',) #:
ATTITUDE = ('stateEstimate.roll', 'stateEstimate.pitch', 'stateEstimate.yaw',) #:

current_log_items = None   # Active tuple of log items

def get_data(log_items, rate=0.1, wait=True):
    """Get a sensor value tuple from the Flight Controller data log.
       This will register for periodic logging of the given log items.
       Pass 'None' to stop data logging packets from Flight Controller.

       Args:
           log_items (tuple): Tuple of str names `Log Values <https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/api/logs/>`_.
                Provided reference tuples: `GYRO`, `RANGERS`, `FLOW`, `ACCEL`, `MAG`, `BAROMETER`
           rate (float): Periodic rate in seconds for flight controller to report data.
           wait (bool): Wait for data to be available. Default is True. Note: if log_items has changed, this function will still block to register the new log items.

       Returns:
           tuple: A tuple of the requested log items.
           None: If no data is available and wait is False.
    """
    global current_log_items
    if log_items is None:
        log_manager.enable(False)
        current_log_items = None
        return None

    if current_log_items != log_items:
        reg_success = log_manager.register_items(log_items, rate)
        if not reg_success:
            raise ValueError("Failed to register log data (too many items?)")
        log_manager.enable(True)

        current_log_items = log_items
        crtp.log_read()  # Flush

    if wait or crtp.log_avail():
        log_manager.fetch_log_data()
        return tuple(log_manager.cache[item] for item in current_log_items)
    
    return None

def get_param(name):
    """Get a single parameter value from Flight Controller.
       Note: these differ from log data.

       Args:
           name (str): See `Param Names <https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/api/params/>`_
    """
    return param_manager.get(name)

def set_param(name, value):
    """Set a single parameter in Flight Controller"""
    return param_manager.set(name, value)

def version():
    """Get version of flight controller firmware
    """
    crtp.flush()
    crtp.send(CRTP_PORT_PLATFORM, 1,'\x02')
    dat = read_crtp(CRTP_PORT_PLATFORM, 1)
    if dat:
        return dat[1:].decode('utf-8')
    else:
        return "timeout"

def is_version_current():
    """Return True if flight controller is running current default firmware version"""
    for _ in range(3):
        ver = version()
        if ver != 'timeout':
            break
        time.sleep(0.1)

    ver = ver.split()[-1]
    is_current = ver == stm_fw.version() or 'dev' in ver
    return is_current

def motor_test(do_run):
    """Run the motors at low speed."""
    if do_run:
        param_manager.set("motorPowerSet.enable", 1)
        param_manager.set("motorPowerSet.m1", 5000)
        param_manager.set("motorPowerSet.m2", 5000)
        param_manager.set("motorPowerSet.m3", 5000)
        param_manager.set("motorPowerSet.m4", 5000)
    else:
        param_manager.set("motorPowerSet.enable", 0)

# TODO: Enable/test this when we roll out a new flight controller version
# if not is_version_current():
#     print("Warning: Flight controller version out of date. Factory reset to install.")

#---- Initialize cflib flight control ----
_cf_driver = crtpstack.CRTPPacket()
cf_commander = commander.Commander(_cf_driver)
fly = motion_commander.MotionCommander(cf_commander, set_param)
fly_high = high_level_commander.HighLevelCommander()

