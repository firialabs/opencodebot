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
