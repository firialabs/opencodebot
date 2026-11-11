# This file is part of CodeAIR, and includes portions of code derived from the
# Crazyflie Python client library.
#
# Copyright (c) 2017 Bitcraze AB
# Modifications Copyright (c) 2024 Firia, Inc.
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 2
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
"""
The MotionCommander is used to make it easy to write scripts that move the
Crazyflie around. Some sort of positioning support is required, for instance
the Flow deck.

The motion commander uses velocity setpoints and does not have a notion of
absolute position, the error in position will accumulate over time.

The API contains a set of primitives that are easy to understand and use, such
as "go forward" or "turn around".

There are two flavors of primitives, one that is blocking and returns when
a motion is completed, while the other starts a motion and returns immediately.
In the second variation the user has to stop or change the motion when
appropriate by issuing new commands.

The MotionCommander can be used as context manager using the with keyword. In
this mode of operation takeoff and landing is executed when the context is
created/closed.
"""
import math
import time
# from queue import Empty
# from queue import Queue
# from threading import Thread

# from cflib.crazyflie.syncCrazyflie import SyncCrazyflie

class MotionCommander:
    """The motion commander"""
    VELOCITY = 0.2
    RATE = 360.0 / 5

    # Default Limits
    MAX_VELOCITY = 0.6
    MAX_RATE = 360.0 / 2
    MAX_HEIGHT = 2.0
    MAX_DISTANCE = 5.0

    # def __init__(self, crazyflie, default_height=0.3):
    def __init__(self, commander, func_set_param, default_height=0.3):
        """
        Construct an instance of a MotionCommander

        :param commander: Instance of Commander class
        :param func_set_param: Function object 'set_param(name, value)'
        :param crazyflie: A Crazyflie or SyncCrazyflie instance
        :param default_height: The default height to fly at
        """
        # if isinstance(crazyflie, SyncCrazyflie):
        #     self._cf = crazyflie.cf
        # else:
        #     self._cf = crazyflie
        self.commander = commander
        self.set_param = func_set_param

        self.default_height = default_height

        self._is_flying = False
        # self._thread = None
        self.setpoint_tracker = SetpointTracker(commander)
        self.enforce_limits = True
        self._t_reset = 0

    def _clamp(self, value, max_value):
        if self.enforce_limits and abs(value) > max_value:
            return max_value if value > 0 else -max_value
        return value
    
    def steady(self, seconds=0):
        """Hold steady on set course for specified duration.
        This function will update the flight controller periodically during the
        wait. Passing 0 will update without delay (non-blocking).

        :param seconds: The time to hold steady (seconds)

        """
        if self._t_reset and time.ticks_diff(time.ticks_ms(), self._t_reset) < 2000:
            # Don't update setpoints if we just reset the kalman filter
            time.sleep(seconds)
            return
        self._t_reset = 0

        if self._is_flying:
            self.setpoint_tracker.poll_for(seconds)
        elif seconds:
            time.sleep(seconds)

    def is_flying(self):
        """Check if currently flying"""
        return self._is_flying

    def enable_flying(self, do_enable):
        """Enable or disable flight.
        After enabling, you must delay for at least 1 second to allow the kalman filter to stabilize
        before taking off.

        :param do_enable: True to enable flying mode, False to disable
        """
        if do_enable == self._is_flying:
            return

        # Set baseline before/after flight
        self.setpoint_tracker.reset()

        self._is_flying = do_enable
        if do_enable:
            # Reset kalman filter. Will automatically be reset to 0.
            self.set_param('kalman.resetEstimation', 1)
            self._t_reset = time.ticks_ms()
        else:
            # Stop using low level setpoints and hand responsibility over to the high level commander.
            self.commander.send_stop_setpoint()
            self.commander.send_notify_setpoint_stop()

    # Distance based primitives

    def take_off(self, height=None, velocity=VELOCITY):
        """
        Takes off, that is starts the motors, goes straight up and hovers.
        Do not call this function if you use the with keyword. Take off is
        done automatically when the context is created.

        :param height: The height (meters) to hover at. None uses the default
                       height set when constructed.
        :param velocity: The velocity (meters/second) when taking off
        :return:
        """
        if self._is_flying:
            raise Exception('Already flying')

        # if not self._cf.is_connected():
        #     raise Exception('Crazyflie is not connected')

        self._is_flying = True
        self._reset_position_estimator()

        # self._thread = _SetPointThread(self._cf)
        # self._thread.start()

        if height is None:
            height = self.default_height

        self.up(height, velocity)

    def land(self, velocity=VELOCITY):
        """
        Go straight down and turn off the motors.

        Do not call this function if you use the with keyword. Landing is
        done automatically when the context goes out of scope.

        :param velocity: The velocity (meters/second) when going down
        :return:
        """
        if self._is_flying:
            # self.down(self._thread.get_height(), velocity)
            self.down(self.setpoint_tracker.get_height(), velocity)

            # self._thread.stop()
            # self._thread = None

            self.commander.send_stop_setpoint()
            # Stop using low level setpoints and hand responsibility over to the high level commander to
            # avoid time out when no setpoints are received any more
            self.commander.send_notify_setpoint_stop()
            self._is_flying = False

    def __enter__(self):
        self.take_off()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.land()

    def left(self, distance_m, velocity=VELOCITY):
        """
        Go left

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(0.0, distance_m, 0.0, velocity)

    def right(self, distance_m, velocity=VELOCITY):
        """
        Go right

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(0.0, -distance_m, 0.0, velocity)

    def forward(self, distance_m, velocity=VELOCITY):
        """
        Go forward

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(distance_m, 0.0, 0.0, velocity)

    def back(self, distance_m, velocity=VELOCITY):
        """
        Go backwards

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(-distance_m, 0.0, 0.0, velocity)

    def up(self, distance_m, velocity=VELOCITY):
        """
        Go up

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(0.0, 0.0, distance_m, velocity)

    def down(self, distance_m, velocity=VELOCITY):
        """
        Go down

        :param distance_m: The distance to travel (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.move_distance(0.0, 0.0, -distance_m, velocity)

    def turn_left(self, angle_degrees, rate=RATE):
        """
        Turn to the left, staying on the spot

        :param angle_degrees: How far to turn (degrees)
        :param rate: The turning speed (degrees/second)
        :return:
        """
        rate = self._clamp(rate, self.MAX_RATE)
        flight_time = angle_degrees / rate

        self.start_turn_left(rate)
        # time.sleep(flight_time)
        self.setpoint_tracker.poll_for(flight_time)
        self.stop()

    def turn_right(self, angle_degrees, rate=RATE):
        """
        Turn to the right, staying on the spot

        :param angle_degrees: How far to turn (degrees)
        :param rate: The turning speed (degrees/second)
        :return:
        """
        rate = self._clamp(rate, self.MAX_RATE)
        flight_time = angle_degrees / rate

        self.start_turn_right(rate)
        # time.sleep(flight_time)
        self.setpoint_tracker.poll_for(flight_time)
        self.stop()

    def circle_left(self, radius_m, velocity=VELOCITY, angle_degrees=360.0):
        """
        Go in circle, counter clock wise

        :param radius_m: The radius of the circle (meters)
        :param velocity: The velocity along the circle (meters/second)
        :param angle_degrees: How far to go in the circle (degrees)
        :return:
        """
        distance = 2 * radius_m * math.pi * angle_degrees / 360.0
        distance = self._clamp(distance, self.MAX_DISTANCE)
        velocity = self._clamp(velocity, self.MAX_VELOCITY)
        flight_time = distance / velocity

        self.start_circle_left(radius_m, velocity)
        # time.sleep(flight_time)
        self.setpoint_tracker.poll_for(flight_time)
        self.stop()

    def circle_right(self, radius_m, velocity=VELOCITY, angle_degrees=360.0):
        """
        Go in circle, clock wise

        :param radius_m: The radius of the circle (meters)
        :param velocity: The velocity along the circle (meters/second)
        :param angle_degrees: How far to go in the circle (degrees)
        :return:
        """
        distance = 2 * radius_m * math.pi * angle_degrees / 360.0
        distance = self._clamp(distance, self.MAX_DISTANCE)
        velocity = self._clamp(velocity, self.MAX_VELOCITY)
        flight_time = distance / velocity

        self.start_circle_right(radius_m, velocity)
        # time.sleep(flight_time)
        self.setpoint_tracker.poll_for(flight_time)
        self.stop()

    def move_distance(self, distance_x_m, distance_y_m, distance_z_m,
                      velocity=VELOCITY):
        """
        Move in a straight line.
        positive X is forward
        positive Y is left
        positive Z is up

        :param distance_x_m: The distance to travel along the X-axis (meters)
        :param distance_y_m: The distance to travel along the Y-axis (meters)
        :param distance_z_m: The distance to travel along the Z-axis (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        distance_z_m = self._clamp(distance_z_m, self.MAX_HEIGHT)
        distance = math.sqrt(distance_x_m * distance_x_m +
                             distance_y_m * distance_y_m +
                             distance_z_m * distance_z_m)
        distance = self._clamp(distance, self.MAX_DISTANCE)
        velocity = self._clamp(velocity, self.MAX_VELOCITY)
        flight_time = distance / velocity

        velocity_x = velocity * distance_x_m / distance
        velocity_y = velocity * distance_y_m / distance
        velocity_z = velocity * distance_z_m / distance

        self.start_linear_motion(velocity_x, velocity_y, velocity_z)
        # time.sleep(flight_time)
        self.setpoint_tracker.poll_for(flight_time)
        self.stop()

    # Velocity based primitives

    def start_left(self, velocity=VELOCITY):
        """
        Start moving left. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(0.0, velocity, 0.0)

    def start_right(self, velocity=VELOCITY):
        """
        Start moving right. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(0.0, -velocity, 0.0)

    def start_forward(self, velocity=VELOCITY):
        """
        Start moving forward. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(velocity, 0.0, 0.0)

    def start_back(self, velocity=VELOCITY):
        """
        Start moving backwards. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(-velocity, 0.0, 0.0)

    def start_up(self, velocity=VELOCITY):
        """
        Start moving up. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(0.0, 0.0, velocity)

    def start_down(self, velocity=VELOCITY):
        """
        Start moving down. This function returns immediately.

        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        self.start_linear_motion(0.0, 0.0, -velocity)

    def stop(self):
        """
        Stop any motion and hover.

        :return:
        """
        self._set_vel_setpoint(0.0, 0.0, 0.0, 0.0)

    def start_turn_left(self, rate=RATE):
        """
        Start turning left. This function returns immediately.

        :param rate: The angular rate (degrees/second)
        :return:
        """
        self._set_vel_setpoint(0.0, 0.0, 0.0, -rate)

    def start_turn_right(self, rate=RATE):
        """
        Start turning right. This function returns immediately.

        :param rate: The angular rate (degrees/second)
        :return:
        """
        self._set_vel_setpoint(0.0, 0.0, 0.0, rate)

    def start_circle_left(self, radius_m, velocity=VELOCITY):
        """
        Start a circular motion to the left. This function returns immediately.

        :param radius_m: The radius of the circle (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        circumference = 2 * radius_m * math.pi
        rate = 360.0 * velocity / circumference

        self._set_vel_setpoint(velocity, 0.0, 0.0, -rate)

    def start_circle_right(self, radius_m, velocity=VELOCITY):
        """
        Start a circular motion to the right. This function returns immediately

        :param radius_m: The radius of the circle (meters)
        :param velocity: The velocity of the motion (meters/second)
        :return:
        """
        circumference = 2 * radius_m * math.pi
        rate = 360.0 * velocity / circumference

        self._set_vel_setpoint(velocity, 0.0, 0.0, rate)

    def start_linear_motion(self, velocity_x_m, velocity_y_m, velocity_z_m, rate_yaw=0.0):
        """
        Start a linear motion with an optional yaw rate input. This function returns immediately.

        positive X is forward
        positive Y is left
        positive Z is up

        :param velocity_x_m: The velocity along the X-axis (meters/second)
        :param velocity_y_m: The velocity along the Y-axis (meters/second)
        :param velocity_z_m: The velocity along the Z-axis (meters/second)
        :param rate: The angular rate (degrees/second)
        :return:
        """
        self._set_vel_setpoint(
            velocity_x_m, velocity_y_m, velocity_z_m, rate_yaw)

    def _set_vel_setpoint(self, velocity_x, velocity_y, velocity_z, rate_yaw):
        if not self._is_flying:
            raise Exception('Can not move on the ground. Take off first!')
        # self._thread.set_vel_setpoint(
        #     velocity_x, velocity_y, velocity_z, rate_yaw)
        velocity_x = self._clamp(velocity_x, self.MAX_VELOCITY)
        velocity_y = self._clamp(velocity_y, self.MAX_VELOCITY)
        velocity_z = self._clamp(velocity_z, self.MAX_VELOCITY)
        rate_yaw = self._clamp(rate_yaw, self.MAX_RATE)

        self.setpoint_tracker.new_vel(velocity_x, velocity_y, velocity_z, rate_yaw)

    def _reset_position_estimator(self):
        self.set_param('kalman.resetEstimation', 1)
        time.sleep(0.1)
        self.set_param('kalman.resetEstimation', 0)
        time.sleep(2)


class SetpointTracker():   # Firia Labs
    """Replaces cflib SetPointThread. Track current setpoint and poll/update the commander.
       * Use self.poll_for(seconds) rather than time.sleep() to keep feeding setpoints. 
       * To do async tasks, you'll need to call self.update() periodically.
    """
    ABS_Z_INDEX = 3

    def __init__(self, commander):
        self.commander = commander
        self.reset()

    def reset(self):
        """Reset "ground" state"""
        self._hover_setpoint = [0.0, 0.0, 0.0, 0.0]
        self._z_base = 0.0
        self._z_velocity = 0.0
        self._z_base_time = 0

    def new_vel(self, velocity_x, velocity_y, velocity_z, rate_yaw):
        """New velocity setpoint"""
        if self._z_velocity:
            self._z_base = self._current_z() if self._z_base_time else 0.0
            
        self._z_velocity = velocity_z
        self._z_base_time = time.ticks_ms()

        self._hover_setpoint = [velocity_x, velocity_y, rate_yaw, self._z_base]
        self.commander.send_hover_setpoint(*self._hover_setpoint)

    def poll_for(self, seconds):
        """Let it fly!"""
        if seconds == 0:
            self.update()
        else:
            if seconds < 0:
                seconds = -seconds

            for _ in range(round(seconds * 10)):
                self.update()
                time.sleep(0.1)

    def get_height(self):
        """Get current height"""
        return self._hover_setpoint[self.ABS_Z_INDEX]

    def update(self):
        """Poll at 100-200ms rate"""
        if self._z_velocity:
            self._update_z_in_setpoint()
        self.commander.send_hover_setpoint(*self._hover_setpoint)

    def _update_z_in_setpoint(self):
        self._hover_setpoint[self.ABS_Z_INDEX] = self._current_z()

    def _current_z(self):
        # What should the new absolute Z value be, based on velocity and time since last update?
        now = time.ticks_ms()
        return self._z_base + self._z_velocity * time.ticks_diff(now, self._z_base_time) / 1000



# class _SetPointThread(Thread):
#     TERMINATE_EVENT = 'terminate'
#     UPDATE_PERIOD = 0.2
#     ABS_Z_INDEX = 3

#     def __init__(self, cf, update_period=UPDATE_PERIOD):
#         Thread.__init__(self)
#         self.update_period = update_period

#         self._queue = Queue()
#         self._cf = cf

#         self._hover_setpoint = [0.0, 0.0, 0.0, 0.0]

#         self._z_base = 0.0
#         self._z_velocity = 0.0
#         self._z_base_time = 0.0

#     def stop(self):
#         """
#         Stop the thread and wait for it to terminate

#         :return:
#         """
#         self._queue.put(self.TERMINATE_EVENT)
#         self.join()

#     def set_vel_setpoint(self, velocity_x, velocity_y, velocity_z, rate_yaw):
#         """Set the velocity setpoint to use for the future motion"""
#         self._queue.put((velocity_x, velocity_y, velocity_z, rate_yaw))

#     def get_height(self):
#         """
#         Get the current height of the Crazyflie.

#         :return: The height (meters)
#         """
#         return self._hover_setpoint[self.ABS_Z_INDEX]

#     def run(self):
#         while True:
#             try:
#                 event = self._queue.get(block=True, timeout=self.update_period)
#                 if event == self.TERMINATE_EVENT:
#                     return

#                 self._new_setpoint(*event)
#             except Empty:
#                 pass

#             self._update_z_in_setpoint()
#             self._cf.commander.send_hover_setpoint(*self._hover_setpoint)

#     def _new_setpoint(self, velocity_x, velocity_y, velocity_z, rate_yaw):
#         self._z_base = self._current_z()
#         self._z_velocity = velocity_z
#         self._z_base_time = time.time()

#         self._hover_setpoint = [velocity_x, velocity_y, rate_yaw, self._z_base]

#     def _update_z_in_setpoint(self):
#         self._hover_setpoint[self.ABS_Z_INDEX] = self._current_z()

#     def _current_z(self):
#         now = time.time()
#         return self._z_base + self._z_velocity * (now - self._z_base_time)
