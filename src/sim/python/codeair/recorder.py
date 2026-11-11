"""CodeAIR: Flight Data Recorder
"""
import time
import traceback
import flight
from codeair_drivers import console_bytes
from ansi_term import *

def _emergency_landing(logger):
    """The default 'abort' function. Make an emergency landing on unhandled exceptions.
    This prevents the drone from simply "stopping mid-air" and crashing when an exception occurs.

    Args:
        logger (FlightDataRecorder): The flight data recorder instance.
    """
    if flight.fly.is_flying():
        import codeair  # Late import to avoid circular dependency
        logger.log(ANSI_FG_YELLOW + "Emergency Landing" + ANSI_RESET)
        codeair.pixels.fill(codeair.RED)
        flight.fly.land()

class FlightDataRecorder:
    """A class to record flight data and handle logging.

    Attributes:
        filename (str): The name of the log file. None for default.
        abort (function): The function to call on an unhandled exception.
    """

    FMODE_OVERWRITE = 0
    FMODE_APPEND = 1
    FMODE_AUTO = 2

    def __init__(self, filename=None, abort=_emergency_landing):
        """Initializes the FlightDataRecorder with a log file and abort function.
        """
        self.filename = filename
        self.abort = abort
        self.log_file = None
        self.file_mode = self.FMODE_AUTO
        self.do_flush = False
        self.reported = False

    def _check_filename(self):
        """Checks if the filename is set, and sets a default if not."""
        if not self.filename:
            import codeair
            self.filename = "flight_log.txt"
            # Log to SD card if available (user must mount first)
            if codeair.sdcard.is_ready():
                self.filename = "/sd/" + self.filename

    def _get_fmode_str(self):
        """Returns the string representation of the file mode."""
        if self.file_mode == self.FMODE_OVERWRITE:
            return "wb"
        elif self.file_mode == self.FMODE_APPEND:
            return "ab"
        elif self.reported:
            return "wb"  # Overwrite if reported
        else:
            return "ab"  # Append if not reported

    def set_file_mode(self, mode, do_flush=False):
        """Sets the file mode for logging. Default is auto mode, which appends unless the log has been reported.

        Args:
            mode (int): The file mode (self.FMODE_OVERWRITE, self.FMODE_APPEND, self.FMODE_AUTO).
            do_flush (bool): Set True to aggressively flush every log write to disk.
        """
        self.file_mode = mode
        self.do_flush = do_flush

    def print_report(self, check_connection=True):
        """Prints the contents of the previous log file to the console.
        
        Args:
            check_connection (bool): If True, check if CodeSpace is connected before reporting.
        """
        import codeair
        if self.log_file:
            print("Can't report while logging.")
            return

        # Ping CodeSpace to see if we can report.
        if check_connection and not codeair.pipe.ping():
            return
        
        self.reported = True

        try:
            self._check_filename()
            with open(self.filename, "rb") as f:
                print("\n==== Begin Log Report ====")
                # Use console_bytes() to print the log file in binary chunks.
                # This enables us to handle binary embedded data (images, charts).
                while True:
                    buf = f.read(128)
                    if not buf:
                        break
                    console_bytes(buf)
                print("==== End Log Report ====\n")
        except OSError:
            print("No flight log found.")

    def __enter__(self):
        """Enters the context for flight data recording.

        Returns:
            FlightDataRecorder: The instance of the flight data recorder.
        """
        try:
            self._check_filename()
            file_mode = self._get_fmode_str()
            self.log_file = open(self.filename, file_mode)
            self.reported = False
            self.log(ANSI_FG_CYAN + "--- Flight Log Started ---" + ANSI_RESET)
            return self
        except OSError as e:
            print(f"Error opening log file: {e}")
            return self

    def __exit__(self, exc_type, exc_value, tb):
        """Exits the context, logging unhandled exceptions.

        Args:
            exc_type (type): The exception type.
            exc_value (Exception): The exception instance.
            tb (traceback): The traceback object.

        Returns:
            bool: False to indicate that exceptions should not be suppressed.
        """
        if self.log_file:
            if exc_type:  # An unhandled exception occurred
                if exc_type == KeyboardInterrupt:
                    self.log(ANSI_FG_YELLOW + "User Stop (KeyboardInterrupt)" + ANSI_RESET)
                else:
                    self.log(ANSI_FG_RED + ">>> Unhandled Exception Occurred <<<" + ANSI_RESET)
                    self.log_exception(exc_value)
                    self.log(ANSI_FG_RED + "<<< End of Unhandled Exception >>>" + ANSI_RESET)

                if self.abort:
                    self.abort(self)

            self.log(ANSI_FG_CYAN + "--- Flight Log Ended ---" + ANSI_RESET)
            self.log_file.close()
            self.log_file = None
        return False  # Do not suppress exceptions

    def log(self, message):
        """Logs a message to the file with a timestamp.

        Args:
            message (str): The message to log.
        """
        timestamp = time.monotonic_ns() / 1000000000
        log_message = f"[{timestamp:.3f}] {message}\n"
        if self.log_file:
            self.log_file.write(log_message)
            if self.do_flush:
                self.log_file.flush()

    def log_exception(self, e):
        """Logs an exception with a traceback.

        Args:
            e (Exception): The exception to log.
        """
        self.log(f"Exception: {e}")
        formatted_traceback = "".join(traceback.format_exception(type(e), e, e.__traceback__))
        self.log(formatted_traceback)

    def write(self, data):
        """Writes raw data to the log file.

        Args:
            data (bytes): The data to write.
        """
        if self.log_file:
            self.log_file.write(data)
            if self.do_flush:
                self.log_file.flush()


# Example Usage
if __name__ == "__main__":
    # Create an instance of FlightDataRecorder
    recorder = FlightDataRecorder()

    # Print the previous log report
    print("Previous Log:")
    recorder.print_report()

    # Use the recorder in a context manager
    with recorder:
        recorder.log("Starting flight...")
        recorder.log("Altitude reached 1 meter")
        result = 10 / 0  # This will cause an exception
        recorder.log("Ending flight.")  # Never reached

    # Indicate that the program has finished
    print("Program finished.")