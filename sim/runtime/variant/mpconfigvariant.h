#define MICROPY_CONFIG_ROM_LEVEL                (MICROPY_CONFIG_ROM_LEVEL_FULL_FEATURES)
#define MICROPY_GC_SPLIT_HEAP                   (1)
#define MICROPY_GC_SPLIT_HEAP_AUTO              (1)
#define MICROPY_PY_WEAKREF                      (1)
#define MICROPY_JSPI (1)
#define MICROPY_SIM (1)

// Count backward branches and returns in C; call out every sim_hook_period.
extern unsigned int sim_hook_count, sim_hook_period;
void sim_vm_hook(void);
#define MICROPY_VM_HOOK_LOOP if (++sim_hook_count >= sim_hook_period) { sim_vm_hook(); }
#define MICROPY_VM_HOOK_RETURN MICROPY_VM_HOOK_LOOP

// As on the devices (CircuitPython): no docstrings. Firia's modules depend on
// it (songplayer and soundlib skip their setup when an object has __doc__).
#define MICROPY_ENABLE_DOC_STRING (0)
