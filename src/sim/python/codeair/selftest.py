"""CodeAIR Selftest Functions"""
from codeair import *
from flight import *
from time import sleep
import os
import time
import stm_fw
import espcamera
from colors import *

# Show status on pixel LEDs during firmware update
i_pix = 0
wr_blk = 0
pix_color = YELLOW
t_change = 0
def fw_progress(st):
    """Optimizing LED writes yeilds significant speedup"""
    global i_pix, pix_color, wr_blk, t_change
    if st == stm32_boot.ST_EXT_ERASE:
        wr_blk = 0          # A single ERASE command is followed by st=0 every 1sec.
        pix_color = PURPLE
    elif st == stm32_boot.ST_WR_MEM:
        pix_color = MAGENTA
        wr_blk = (wr_blk + 1) % 4  # Every 4th block (256 bytes) ping LEDs (otherwise too fast!)
        if wr_blk == 0:
            fw_progress(0)
    elif st == 0xF0:
        pix_color = BLUE  # decompressing
        fw_progress(0)
    elif st == 0:
        # Comes every 1s when flash writer is waiting on ack, but also using this for ST_xx events above.
        # - Using ticks to pace this, since neopixel writes are sloooow.
        ms = time.ticks_ms()
        if time.ticks_diff(ms, t_change) > 500:
            t_change = ms
            i_pix = (i_pix + 1) % 4
            n_led = i_pix * 2

            pixels.off()
            pixels.set(n_led, pix_color)
            pixels.set(n_led + 1, pix_color)
            pixels._strip.show()

def check_firmware():
    """Compare flight controller firmware to our current latest version, update if needed"""
    for _ in range(3):
        ver = version()
        if ver != 'timeout':
            break
        sleep(0.1)

    ver = ver.split()[-1]
    if ver != stm_fw.version() and not 'dev' in ver:
        print(f"Updating firmware from '{ver}' to v{stm_fw.version()}")
        pixels._strip.auto_write = False
        fw_progress(0xF0)
        stat = load_fw(prog=fw_progress)
        pixels._strip.auto_write = True
        if stat:
            # Yaay!
            pixels.fill(GREEN)
            speaker.beep(440, 100)
            speaker.beep(880, 200)
        else:
            # Boooo.
            pixels.fill(RED)
            speaker.beep(440, 100)
            speaker.beep(220, 500)

def check_fcon_sensors(reset_buf=False):
    """Harvest STM32 power-on selftest results"""
    tests = (
        ('U12 Flow Sensor', 'Motion chip id: 0x49:0xB6'),
        ('U3 IMU Gyro I2C', 'BMI088 Gyro connection [OK]'),
        ('U3 IMU Gyro test', 'BMI088 gyro self-test [OK]'),
        ('U3 IMU Accel test', 'BMI088 Accel connection [OK]'),
        ('U4 Pressure', 'BMP390 I2C connection [OK]'),
        ('Ranger FWD', 'Init front sensor [OK]'),
        ('U8 ranger UP', 'Init up sensor [OK]'),
        ('U9 ranger DOWN', 'Init down sensor [OK]'),
        ('Self Test', 'Self test passed!'),
        ('Ready to Fly', 'Ready to fly'),
    )

    # Retrieve console buffer
    buf = crtp.console_read() + crtp.console_read()
    if len(buf) < 1000 or reset_buf:
        # Reboot STM32, and allow time for complete bootup sequence (typical 4sec)
        reset_controller()
        sleep(5)
        buf = crtp.console_read() + crtp.console_read()

    # Flight controller 1.1.1 is for boards without the U4 pressure sensor. Ask for the version
    # directly: the boot banner scrolls out of the 1024-byte console buffer before we read it.
    for _ in range(3):
        ver = version()
        if ver != 'timeout':
            break
        sleep(0.1)
    no_baro = ver.split()[-1] == '1.1.1'

    # Check for errors
    errbuf = ''
    for msg, rpt in tests:
        if no_baro and msg == 'U4 Pressure':
            continue
        ok = rpt in buf
        if not ok:
            errbuf += msg + '\n'

    return errbuf

def check_camera_init():
    """Is at least I2C responding?"""
    return camera is not None

def check_camera_viz(threshold=128):
    """Return ratio of grayscale pixels above given 8-bit threshold"""
    if not camera:
        return 0
    
    camera.reconfigure(pixel_format=espcamera.PixelFormat.GRAYSCALE)

    bitmap = camera.take()

    white_pixel_count = 0
    total_pixels = bitmap.width * bitmap.height

    for x in range(bitmap.width):
        for y in range(bitmap.height):
            pixel_value = bitmap[x, y]  # Access the pixel value in the Bitmap
            if pixel_value >= threshold:
                white_pixel_count += 1

    white_ratio = white_pixel_count / total_pixels
    return white_ratio

def record(failures):
    """Record test results to flash file 'mfgtest.txt'
       The 'failures' param is a string with comma-separated failed test name(s).
    """
    with open('mfgtest.txt', 'a') as fp:
        fp.write('\n--- Manufacturing Test Complete ---\n\n')
        if not failures:
            fp.write('All tests PASS')
        else:
            fp.write('Failed tests: %s\n--------\n' % failures)

    os.sync()

def check_sd():
    """Return True if SD card works, False if not"""
    if not sdcard.mount():
        return False

    message = 'Your SD card works perfectly!'
    stat = False
    try:
        with open('/sd/mfgtest.txt', 'w') as fp:
            fp.write(message)

        os.sync()

        with open('/sd/mfgtest.txt') as fp:
            buf = fp.read()

        stat = (buf == message)
    except:
        pass

    return stat