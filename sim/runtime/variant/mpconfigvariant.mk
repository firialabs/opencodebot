# Robot simulator variant: the browser (JSPI) variant plus a VM hook that
# charges simulated time and can suspend to the JS event loop, a sleep that
# advances simulated time, and every clock on simulated time.
FROZEN_MANIFEST ?= variants/sim/manifest.py
SUPPORT_LONGJMP = wasm
JSFLAGS += -s JSPI
JSFLAGS += -s JSPI_EXPORTS=mp_js_do_exec_async,proxy_c_to_js_resume,mp_js_repl_process_char_async
JSFLAGS += -s ALLOW_MEMORY_GROWTH
EXPORTED_FUNCTIONS_EXTRA += ,_sim_set_hook_period
SRC_C += variants/sim/simhook.c
