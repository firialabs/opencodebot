// Simulator hooks. The VM runs on simulated time, which the world owns
// (src/sim/runtime/vm.js installs Module.sim):
// - every sim_hook_period backward branches or returns, the VM charges the
//   world for the time those bytecodes take on the device, and suspends to
//   the JS event loop when the world asks (to pace against the wall clock and
//   to take messages: pause, step, stop);
// - sleeping advances simulated time and suspends;
// - every clock reads the world's clock.
// Suspending uses JSPI and is only possible from the outermost call into the
// VM; inside a callback from JS the hooks only advance time.
#include <emscripten.h>
#include "py/runtime.h"
#include "py/mphal.h"

bool mp_js_can_suspend(void);
void mp_js_suspension_begin(void);
void mp_js_suspension_end(void);

unsigned int sim_hook_count = 0;
unsigned int sim_hook_period = 0xffffffffu; // off until JS sets it

void sim_set_hook_period(unsigned int n) {
    sim_hook_period = n ? n : 0xffffffffu;
    sim_hook_count = 0;
}

// Charge n branches of simulated time; nonzero asks to yield.
EM_JS(int, sim_js_charge, (unsigned int n), {
    return Module.sim.charge(n);
});

// Advance simulated time without yielding.
EM_JS(void, sim_js_advance, (unsigned int us), {
    Module.sim.advance(us);
});

// Yield to the event loop (and wait there while paused).
EM_ASYNC_JS(void, sim_js_yield, (void), {
    await Module.sim.yield();
});

// Advance simulated time by us, then pace and yield.
EM_ASYNC_JS(void, sim_js_delay, (unsigned int us), {
    await Module.sim.delay(us);
});

EM_JS(unsigned int, sim_js_ticks_us, (void), {
    return Module.sim.ticksUs() >>> 0;
});

EM_JS(double, sim_js_time_ms, (void), {
    return Module.sim.timeMs();
});

mp_uint_t sim_ticks_us(void) {
    return sim_js_ticks_us();
}

uint64_t sim_time_ms(void) {
    return (uint64_t)sim_js_time_ms();
}

void sim_vm_hook(void) {
    unsigned int n = sim_hook_count;
    sim_hook_count = 0;
    if (sim_js_charge(n) && mp_js_can_suspend()) {
        mp_js_suspension_begin();
        sim_js_yield();
        mp_js_suspension_end();
    }
}

void sim_delay_us(mp_uint_t us) {
    if (mp_js_can_suspend()) {
        mp_js_suspension_begin();
        sim_js_delay(us);
        mp_js_suspension_end();
    } else {
        sim_js_advance(us);
    }
    // A stop requested while suspended is a pending KeyboardInterrupt.
    mp_handle_pending(true);
}

// Line-level stepping. A trace function in C (no Python runs per line, so
// simulated time is untouched): a frame of main.py gets line events, which go
// to the engine (Module.sim.line); when it answers 1 the program pauses
// there, as at any other suspension. Turned on by _simtrace.on() just before
// main.py runs.
#include <string.h>
#include "py/profile.h"
#include "py/objcode.h"

EM_JS(int, sim_js_line, (int line), {
    return Module.sim.line(line);
});

static mp_obj_t sim_trace(mp_obj_t frame_in, mp_obj_t event, mp_obj_t arg);
static MP_DEFINE_CONST_FUN_OBJ_3(sim_trace_obj, sim_trace);

static bool sim_frame_is_main(mp_obj_frame_t *f) {
    qstr file = MP_CODE_QSTR_MAP(f->code->context, 0);
    return strcmp(qstr_str(file), "main.py") == 0;
}

static mp_obj_t sim_trace(mp_obj_t frame_in, mp_obj_t event, mp_obj_t arg) {
    (void)arg;
    mp_obj_frame_t *f = MP_OBJ_TO_PTR(frame_in);
    if (event == MP_OBJ_NEW_QSTR(MP_QSTR_call)) {
        return sim_frame_is_main(f) ? MP_OBJ_FROM_PTR(&sim_trace_obj) : mp_const_none;
    }
    if (event == MP_OBJ_NEW_QSTR(MP_QSTR_line)) {
        if (sim_js_line((int)f->lineno) && mp_js_can_suspend()) {
            mp_js_suspension_begin();
            sim_js_yield();
            mp_js_suspension_end();
        }
    }
    return MP_OBJ_FROM_PTR(&sim_trace_obj);
}

static mp_obj_t simtrace_on(void) {
    return mp_prof_settrace(MP_OBJ_FROM_PTR(&sim_trace_obj));
}
static MP_DEFINE_CONST_FUN_OBJ_0(simtrace_on_obj, simtrace_on);

static mp_obj_t simtrace_off(void) {
    return mp_prof_settrace(mp_const_none);
}
static MP_DEFINE_CONST_FUN_OBJ_0(simtrace_off_obj, simtrace_off);

static const mp_rom_map_elem_t simtrace_globals_table[] = {
    { MP_ROM_QSTR(MP_QSTR___name__), MP_ROM_QSTR(MP_QSTR__simtrace) },
    { MP_ROM_QSTR(MP_QSTR_on), MP_ROM_PTR(&simtrace_on_obj) },
    { MP_ROM_QSTR(MP_QSTR_off), MP_ROM_PTR(&simtrace_off_obj) },
};
static MP_DEFINE_CONST_DICT(simtrace_globals, simtrace_globals_table);

const mp_obj_module_t simtrace_module = {
    .base = { &mp_type_module },
    .globals = (mp_obj_dict_t *)&simtrace_globals,
};
MP_REGISTER_MODULE(MP_QSTR__simtrace, simtrace_module);
