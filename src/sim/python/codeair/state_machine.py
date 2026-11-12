# Copyright (c) 2025 Firia Labs
""" State Machine - lightweight task scheduler and state machine framework."""
import time
from ansi_term import *

class State:
    """
    Represents a state in the state machine.
    """
    def __init__(self, state_machine, handler):
        """
        Initializes a State instance.
        (Used by StateMachine - not usually used directly by end-user code)

        Args:
            state_machine (StateMachine): The state machine this state belongs to.
            handler (function): The function that handles state events.
        """
        self.name = str(handler).split()[1]  # CircuitPython doesn't have __name__ attribute
        self.state_machine = state_machine
        self.handler_function = handler
        self._entry_time = None

    def enter(self):
        """Called when entering the state."""
        self._entry_time = time.monotonic_ns()
        self.handler_function(self.state_machine, "enter", None, 0) # Call handler with "enter" event, st_time=0

    def exit(self):
        """Called when exiting the state."""
        elapsed_time = (time.monotonic_ns() - self._entry_time) / 1000000000
        self.handler_function(self.state_machine, "exit", None, elapsed_time) # Call handler with "exit" event, st_time at exit

    def handle_event(self, event_type, event_data):
        """
        Handles events within the state.

        Args:
            event_type (str): The type of event.
            event_data (any): The data associated with the event.
        """
        elapsed_time = (time.monotonic_ns() - self._entry_time) / 1000000000
        self.handler_function(self.state_machine, event_type, event_data, elapsed_time) # Pass event info and st_time


class StateMachine:
    """
    A simple state machine framework with task scheduling capabilities.
    """
    def __init__(self):
        """Initializes a StateMachine instance."""
        self.states = {}  # {state_func: State}
        self.current_state = None
        self.initial_state_func = None
        self.running = False
        self.debug = False
        self.debug_log = print
        self._recursion_depth = 0
        self.MAX_RECURSION_DEPTH = 5
        self.task_list = []
        self.tasks_for_removal = []
        self.TASK_WARNING_THRESHOLD = 0.05 # seconds

    def enable_debug(self, do_debug, log_func=print):
        """
        Enables or disables debug logging.

        Args:
            do_debug (bool): If True, enables debug logging.
            log_func (function): The function to use for logging. Defaults to print.
        """
        self.debug = do_debug
        self.debug_log = log_func

    def add_task(self, callback, interval, args=None):
        """
        Adds a task to be run periodically at a specified interval.

        Args:
            callback (function): The function to be called.
            interval (float): The interval in seconds between task executions.
            args (tuple, optional): Arguments to pass to the callback function.
        """
        if not callable(callback):
            raise TypeError("add_task() expects a function object.")
        if args is not None and not hasattr(args, 'index'):
            args = (args,)
        next_run = time.monotonic_ns() + int(interval * 1000000000)
        self.task_list.append((next_run, interval, callback, args))

    def remove_task(self, callback):
        """
        Removes a task from the task list.

        Args:
            callback (function): The function to be removed.
        """
        if self.debug:
            task_funcs = [task[2] for task in self.task_list]
            callback_count = task_funcs.count(callback)
            if callback_count == 0:
                self.debug_log(f"{ANSI_FG_YELLOW}Warning: task {callback} not found for removal.{ANSI_RESET}")
            elif callback_count > 1:
                self.debug_log(f"{ANSI_FG_YELLOW}Warning: removing {callback_count} instances of task {callback}.{ANSI_RESET}")

        self.tasks_for_removal.append(callback)

    def sync_task(self, callback, ns_sync=None):
        """
        Set task periodic interval to align with ns_sync as basis. Default to now (time.monotonic_ns())

        Args:
            callback (function): The function to be synced.
            ns_sync (int, optional): The time in nanoseconds to sync to. Defaults to None, which uses the current time.
        """
        if ns_sync is None:
            ns_sync = time.monotonic_ns()
        
        # Set task to run at ns_sync + interval
        for i, (next_run, interval, cb, args) in enumerate(self.task_list):
            if cb == callback:
                self.task_list[i] = (ns_sync + int(interval * 1000000000), interval, cb, args)
                return
            
        raise ValueError(f"Task {callback} not found in task list. Cannot sync.")

    def schedule(self, callback, delay, args=None):
        """
        Schedules a task to be run once after a delay.

        Args:
            callback (function): The function to be called.
            delay (float): The delay in seconds before the task is executed.
            args (tuple, optional): Arguments to pass to the callback function.
        """
        if not callable(callback):
            raise TypeError("schedule() expects a function object.")
        def sked_callback(*args):
            callback(*args)
            self.remove_task(sked_callback)
        self.add_task(sked_callback, delay, args)

    def run_tasks(self):
        """Runs all scheduled tasks that are due."""
        if self.tasks_for_removal:
            self.task_list = [task for task in self.task_list if task[2] not in self.tasks_for_removal]
            self.tasks_for_removal.clear()

        now = time.monotonic_ns()
        for i, (next_run, interval, callback, args) in enumerate(self.task_list):
            if now >= next_run:
                if self.debug:
                    try:
                        t_call = time.monotonic_ns()
                        callback(*args) if args else callback()  # Run the scheduled task
                        duration = (time.monotonic_ns() - t_call) / 1000000000
                        if duration > self.TASK_WARNING_THRESHOLD:
                            self.debug_log(f"{ANSI_FG_YELLOW}Warning: task took too long: {duration}s ({callback}){ANSI_RESET}")
                    except Exception:
                        self.debug_log(f"{ANSI_FG_YELLOW}Error calling {callback} with args {args}{ANSI_RESET}")
                        raise
                else:
                    callback(*args) if args else callback()  # Run the scheduled task

                self.task_list[i] = (now + int(interval * 1000000000), interval, callback, args) # Update next run time

    def add_state(self, state_func):
        """
        Adds a state to the state machine.
        state_func must be a callable that takes four arguments:

        .. code-block:: python

            def func(state_machine, event_type, event_data, st_time):
                pass
                        
        * The state_func() will be called on every next_state transition, with the event_type set to "enter" or "exit". 
        * It will also be called when event() is called, with event_type set to the event type passed to event().
        * The st_time argument is the elapsed time since the state was entered, in seconds.

        Args:
            state_func (function): The function that handles the state.
        """
        if not callable(state_func):
            raise TypeError("add_state() expects a function object.")
        state = State(self, state_func)
        if state_func in self.states:
            raise ValueError(f"State with name '{state.name}' already exists.")
        if not self.states: # Set initial state if first state added
            self.initial_state_func = state_func
        self.states[state_func] = state

    def current(self):
        """Return currently active state function"""
        return self.current_state.handler_function if self.current_state else None

    def start(self, first_state=None):
        """Starts or re-starts the state machine.
        
        Args:
            first_state (function, optional): The function that handles the initial state. Defaults to the first state added.
        """
        if not self.states:
            raise Exception("StateMachine has no states defined.")
        if first_state:
            self.initial_state_func = first_state
        self.running = True
        self.current_state = None
        self.next_state(self.initial_state_func)

    def next_state(self, next_state_func, sched_delay=None):
        """
        Transitions to a new state.

        Args:
            next_state_func (function): The function that handles the next state.
            sched_delay(float): Optional schedule delay (seconds) before transition. Use 0 to schedule ASAP and break recursion.
        """
        if not self.running:
            raise Exception("StateMachine not started. Call start() first.")
        if next_state_func not in self.states:
            raise ValueError(f"State not found.")
        if self.current_state and self.current_state.handler_function == next_state_func:
            return  # Already in this state
        if sched_delay is not None:
            self.schedule(self.next_state, sched_delay, next_state_func)
            return

        if self.debug:
            self._recursion_depth += 1
            if self._recursion_depth > self.MAX_RECURSION_DEPTH:
                raise RuntimeError("Recursive state transition detected. Check your enter/exit handlers.")

        if self.current_state:
            if self.debug:
                self.debug_log(f"{ANSI_FG_GREEN}Exiting state: {self.current_state.name}{ANSI_RESET}")
            self.current_state.exit() # Exit current state

        self.current_state = self.states[next_state_func]
        if self.debug:
            self.debug_log(f"{ANSI_FG_GREEN}Entering state: {self.current_state.name}{ANSI_RESET}")

        self.current_state.enter() # Enter new state

        if self.debug:
            self._recursion_depth -= 1

    def event(self, event_type, event_data=None):
        """
        Injects an event into the state machine, handled by the current state.

        Args:
            event_type (str): The type of event.
            event_data (any, optional): The data associated with the event.
        """
        if self.current_state:
            self.current_state.handle_event(event_type, event_data)

