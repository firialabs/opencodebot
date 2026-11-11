"""CodeAIR factory test and remote flight interface.

   This program allows a CodeX to be paired with the CodeAIR for remote controlled flight and telemetry.
   Pairing is done via close-range infrared (IR), while remote flight is via radio link.
"""
import radio
from codeair import *
from flight import *
from time import sleep
import time
import infrared
import json
import os
import microcontroller
import selftest

PAIRING_SAVE_FILENAME = 'pairing.json'

radio.on()
ir = infrared.Infrared()
rf_chan = 0
rf_id = 0

def radio_send(op, args=()):
    """Transmit a CodeAIR packet (ch, id, op, args) to paired CodeAIR"""
    msg = json.dumps((rf_chan, rf_id, op, args))
    radio.send(msg)

def radio_poll(timeout=0.1):
    """Wait up to timeout secs to receive a CodeAIR packet. Return (ch, id, op, args) or None"""
    timeout *= 1000
    t_start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t_start) < timeout:
        msg = radio.receive()
        if msg:
            # print("RX: ", msg)
            try:
                rch, rnid, op, args = json.loads(msg)
            except:
                continue
            if rch == rf_chan and rnid == rf_id:
                return (op, args)
        else:
            sleep(0.01)

    return None

blue_brightness = 50
i_led = 0
dir_led = +1

def cycle_blue():
    """Call periodically to cycle blue LEDs in KITT pattern"""
    global i_led, dir_led
    leds.set(i_led, 0)
    i_led = i_led + dir_led
    if i_led == 0 or i_led == 7:
        dir_led *= -1

    leds.set(i_led, blue_brightness)

def save_pairing(ch, nid):
    """Save pairing info to local file."""
    rec = (ch, nid)
    try:
        with open(PAIRING_SAVE_FILENAME, 'wb') as fp:
            json.dump(rec, fp)
    except:
        print("Unable to save pairing.")

def get_saved_pairing():
    """Return (ch, nid) or None if no save file found."""
    try:
        with open(PAIRING_SAVE_FILENAME) as fp:
            ch, nid = json.load(fp)
            return (ch, nid)
    except:
        print("No pairing found.")
    
    return None

def forget_pairing():
    try:
        os.remove(PAIRING_SAVE_FILENAME)
    except:
        pass

    os.sync()
    time.sleep(0.2)
    microcontroller.reset()

def seek_pairing():
    """Wait to receive IR pairing message over infrared.
       Return paired (ch, nid).
    """
    while True:
        cycle_blue()
        buf = ir.receive()
        if buf:
            # print("rx(%d)" % len(buf), buf)
            if buf[0] == 'P' and len(buf) == 3:
                ch = ord(buf[1])
                nid = ord(buf[2])
                # print("tx: %d:%d" % (ch, nid))
                ir.send('X' + buf[1] + buf[2])
                ir.flush()
                speaker.beep(440, 100)
            elif buf == "ACK":
                # print("got ACK!")
                break

        sleep(0.05)

    leds.set_mask(0xFF, 0)
    speaker.beep(1000, 100)
    for _ in range(3):
        pixels.fill(GREEN)
        sleep(0.1)
        pixels.off()
        sleep(0.05)
    return (ch, nid)

# Controller info bitfields
CF_INFO_CAN_ARM  = 0x01
CF_INFO_IS_ARMED = 0x02
CF_INFO_AUTO_ARM = 0x04
CF_INFO_CAN_FLY  = 0x08
CF_INFO_FLYING   = 0x10
CF_INFO_TUMBLED  = 0x20
CF_INFO_LOCKED   = 0x40
CF_INFO_CRASHED  = 0x80

class FlightControl:
    """Manage flying commands from remote paired CodeX"""
    # States
    IDLE = 0
    CAL1 = 1
    CAL2 = 2
    TAKINGOFF = 3
    FLYING = 4
    LANDING = 5
    statenames = ("IDLE", "CAL1", "CAL2", "TAKINGOFF", "FLYING", "LANDING", )

    def __init__(self):
        self.TAKEOFF_CEILING = 0.3  # m (initial height)
        self.TOO_CLOSE = 0.3  # m (for collision avoidance)
        self.HEIGHT_CEILING = 3.0  # m (max height allowed)
        self.BATT_MIN = 3.2    # V (lower and we land automatically)
        self.WARN_FREQ = 880   # Warning tone pre-takeoff
        self.CAL_DELAY = 2000  # ms
        self.LANDED_ALT_MM = 25  # mm height considered "landed"
        self.ZDIFF_ADJ = 100.0  # m : attempt to correct height if measured vs predicted Z exceeds this.
                                # Large value of ZDIFF_ADJ to disable feature by default.

        # Telemetry
        self.rng_front = 0
        self.rng_up = 0
        self.rng_down = 0
        self.heading = 0
        self.batt = 0
        self.cf_info = 0
        self.debug_lvl = 1  # 0-5 => none -> verbose

        # Tracking poll rate (windowed average)
        self.last_poll_ms = 0
        self.poll_win = [0] * 10
        self.poll_sum = 0
        self.poll_rate = 1.0  # Init long, don't fly till we see fast (~100ms) polling

        self.z_calc = 0.0  # calculated height
        self.t_cal = 0
        self.setpoint_override = None
        self.takeoff_sound = 0
        self.set_state(self.IDLE)

    def set_state(self, new_state):
        self.state = new_state
        leds.set_mask(1 << self.state, blue_brightness)
        if self.debug_lvl:
            debug = "state=%s, poll_rate=%1.2f" % (self.statenames[self.state], self.poll_rate)
            radio_send("prt", (debug,))
            print("%9d : state=%d, poll_rate=%1.2f" % (time.ticks_ms(), self.state, self.poll_rate))

    def takeoff(self):
        """Ascend autonomously to self.TAKEOFF_CEILING"""
        if self.state != self.IDLE or  \
           self.rng_down > 50 or       \
           self.poll_rate > 0.3 or     \
           not (self.cf_info & CF_INFO_CAN_FLY) or \
           self.batt < self.BATT_MIN:
            return  # Can't take off!

        # Reset position estimator
        set_param('kalman.resetEstimation', 1)
        self.t_cal = time.ticks_ms()
        self.z_calc = 0.0

        # Autonomous ascent to self.TAKEOFF_CEILING
        self.setpoint_override = (0, +0.2, 0)
        self.set_state(self.CAL1)

        # Begin warning tones
        self.takeoff_sound = 0
        self.cycle_takeoff_sound()

        # Flying colors!  Right=GREEN, Left=RED, Rear=WHITE
        pixels.set((GREEN, GREEN, RED, RED, WHITE, WHITE, WHITE, WHITE))

    def land(self):
        """Descend gracefully to ground"""
        if not self.state == self.FLYING:
            return

        self.landing_sound = 10
        speaker.beep(300 * self.landing_sound * 100, 0)

        # Descend to ground
        self.setpoint_override = (0, -0.2, 0)
        self.set_state(self.LANDING)

    def cycle_takeoff_sound(self):
        self.takeoff_sound = (self.takeoff_sound + 1) % 5
        if self.takeoff_sound < 3:
            speaker.beep(self.WARN_FREQ, 0)
        else:
            speaker.off()

    def update_setpoint(self, x_vel, z_vel, yaw):
        """Handle new OTA setpoint received from radio controller"""
        if self.state == self.CAL1:
            ms = time.ticks_ms()
            if time.ticks_diff(ms, self.t_cal) > 100:
                set_param('kalman.resetEstimation', 0)
                self.set_state(self.CAL2)
                self.t_cal = ms
                self.cycle_takeoff_sound()
            return
        elif self.state == self.CAL2:
            ms = time.ticks_ms()
            self.cycle_takeoff_sound()
            if time.ticks_diff(ms, self.t_cal) > self.CAL_DELAY:
                speaker.off()
                self.set_state(self.TAKINGOFF)
                self.t_cal = ms
            return
        elif self.state == self.LANDING:
            if self.landing_sound:
                self.landing_sound -= 1
                if self.landing_sound == 0:
                    speaker.off()
                else:
                    speaker.beep(300 + self.landing_sound * 100, 0)
            if self.rng_down < self.LANDED_ALT_MM:
                self.stop()
                return
        elif self.state == self.IDLE:
            return
        
        if self.setpoint_override:
            x_vel, z_vel, yaw = self.setpoint_override

        # Collision avoidance
        if self.rng_up < (self.TOO_CLOSE * 1000):
            z_vel = min(z_vel, 0)  # restrict to down movement
            radio_send("prt", ("up limit!",))
        if self.rng_front < (self.TOO_CLOSE * 1000):
            x_vel = min(x_vel, 0)  # restrict to backward movement
            radio_send("prt", ("front limit!",))
        if self.rng_down < (self.TOO_CLOSE * 1000):
            z_vel = max(z_vel, -0.2)  # up or slowly descending
            radio_send("prt", ("down limit!",))

        # Calculate zdistance
        zdistance = self.calc_target_height(z_vel)

        # Enforce a ceiling
        if zdistance > self.HEIGHT_CEILING:
            zdistance = self.HEIGHT_CEILING
            radio_send("prt", ("enforcing max z!",))

        if self.state == self.TAKINGOFF:
            zdistance = min(zdistance, self.TAKEOFF_CEILING)
            ms = time.ticks_ms()
            if time.ticks_diff(ms, self.t_cal) > 2000:  # 2 sec should get us to initial height
                self.setpoint_override = None
                self.set_state(self.FLYING)
        
        # Make it fly!
        cf_commander.send_hover_setpoint(x_vel, 0, yaw, zdistance)

        if self.debug_lvl > 4:
            debug = "hover(v=%1.1f, yr=%1.1f, zabs=%1.3f) zvel=%1.2f, zrng=%3.1f" % (x_vel, yaw, zdistance, z_vel, self.rng_down)
            radio_send("prt", (debug,))

    def calc_target_height(self, z_vel):
        """Return the target height at given z_vel considering poll rate"""
        self.z_calc += z_vel * self.poll_rate

        # Test: detect flying over objects
        z_meas = self.rng_down / 1000
        z_diff = z_meas - self.z_calc
        if z_vel == 0 and abs(z_diff) > self.ZDIFF_ADJ:
            # Attempt to correct height estimate
            self.z_calc = z_meas
            if self.debug_lvl > 1:
                radio_send("prt", ("z_diff=%2.3f" % z_diff ,))

        return self.z_calc

    def stop(self):
        """Called after landing, or to catastrophically Abort flight"""
        # Stop using low level setpoints and hand responsibility over to the high level commander to
        # avoid time out when no setpoints are received any more
        cf_commander.send_stop_setpoint()
        cf_commander.send_notify_setpoint_stop()
        self.setpoint_override = None
        speaker.off()
        pixels.off()
        self.set_state(self.IDLE)

    def abort(self):
        """Stop immediately, plummet to the ground! Also, recover from 'CRASHED' state."""
        radio_send("prt", ("**ABORT!",))
        self.stop()
        speaker.off()
        if self.cf_info & CF_INFO_CRASHED:
            # If we're in crashed state, ABORT command will reboot the STM32
            reset_controller()
            sleep(0.1)
            microcontroller.reset()  # The big hammer. Should be able to recover without this :-/

    def track_poll_rate(self):
        """Call each time we're polled, maintains accurate poll rate"""
        # Maintaining a windowed average of the poll rate over the last len(self.poll_win) polls.
        # Possibly overkill, since we could just hardcode the rate.
        ms = time.ticks_ms()
        dt = time.ticks_diff(ms, self.last_poll_ms)
        self.last_poll_ms = ms
        old = self.poll_win.pop()
        self.poll_win.insert(0, dt)
        self.poll_sum += dt - old
        self.poll_rate = (self.poll_sum / len(self.poll_win)) / 1000   # seconds

    def check_low_batt(self):
        if self.batt < self.BATT_MIN:
            self.land()

    def update_dat(self, front, up, down, heading, thrust, info, batt):
        """Called from radio controller poll loop. Should be called at 100ms rate."""
        self.track_poll_rate()
        self.rng_front = front
        self.rng_up = up
        self.rng_down = down
        self.heading = heading
        self.cf_info = info
        self.batt = batt
        self.check_low_batt()


# Basic telemetry data report is "d1"
# d1 => (front, up, down, heading, thrust, info, batt)  -- bat from ESP32 side
# Logging: rangers(2+2+2)+yaw(4)+thrust(4)+info(2) = 16 bytes  (26 byte limit)
D1_GROUP = ('range.front', 'range.up', 'range.zrange', 'stateEstimate.yaw', 'stabilizer.thrust', 'supervisor.info')

def enter_ctrl_mode():
    """Control loop - receive and execute remote commands"""
    global rv
    print("Ctrl mode: ch=%d, nid=%d" % (rf_chan, rf_id))
    radio.config(channel=rf_chan)

    # Loop taking commands via radio!
    while True:
        ret = radio_poll()
        if ret:
            op, args = ret
            if op == "ver":
                ver = version()
                radio_send(op, (ver,))
            elif op == "d1":
                # Primary flight telemetry data
                dat = get_data(D1_GROUP) + (power.battery_voltage(1), )
                fcon.update_dat(*dat)
                if args:
                    x_vel, z_vel, yaw = args
                    fcon.update_setpoint(x_vel / 100, z_vel / 100, yaw)  # Convert cm/s to m/s
                radio_send(op, dat)
            elif op == "d2":
                # Diagnostics for self-test, etc.
                dat = get_data(FLOW)  # (dX, dY)
                radio_send(op, dat)
            elif op == "led":
                i_led, color = args
                n_led = i_led * 2
                pixels.set(n_led, color)
                pixels.set(n_led + 1, color)
            elif op == "fly":
                do_fly = args[0]
                if do_fly:
                    fcon.takeoff()
                else:
                    fcon.land()
            elif op == "abt":
                fcon.abort()
            elif op == "py":
                try:
                    rv = None
                    exec(args[0], locals(), globals()) # explicit locals/globals reqd for frozen
                    if fcon.debug_lvl:
                        print(f"exec({args[0]}) => {rv}")
                    if not rv is None:
                        radio_send(op, (rv,))
                except Exception as err:
                    print("Error executing py command: ", err)

        if buttons.was_pressed(BTN_0):
            leds.set_mask(0xFF, 0)
            sleep(0.1)
            buttons.was_pressed()
            for count in range(20):
                leds.set_mask(0x80, 70)
                sleep(0.1)
                leds.set_mask(0xFF, 0)
                sleep(0.1)
                if buttons.was_pressed(BTN_1):
                    forget_pairing()

def run():
    """Main program"""
    global fcon, rf_chan, rf_id
    print("--- Flight Controller ---")

    fcon = FlightControl()

    # Check flight controller (STM32) firmware version
    selftest.check_firmware()

    # Allow remote CodeX to pair
    sync = get_saved_pairing()
    if not sync:
        sync = seek_pairing()
        save_pairing(*sync)

    # Use paired controller for flying!
    rf_chan, rf_id = sync
    enter_ctrl_mode()


if __name__ == '__main__':
    run()
