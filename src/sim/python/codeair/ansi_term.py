"""ANSI terminal control sequences for display attributes.

Use these constants to format text in the console terminal.
Example:
    print(ANSI_FG_GREEN + "Green text" + ANSI_RESET + " normal text")

"""

ANSI_CSI = '\x1b['
ANSI_RESET = ANSI_CSI + '0m'

# Text attributes
ANSI_BOLD = ANSI_CSI + '1m'
ANSI_FAINT = ANSI_CSI + '2m'
ANSI_ITALIC = ANSI_CSI + '3m'
ANSI_UNDERLINE = ANSI_CSI + '4m'
ANSI_BLINK_SLOW = ANSI_CSI + '5m'
ANSI_BLINK_FAST = ANSI_CSI + '6m'
ANSI_REVERSE = ANSI_CSI + '7m'
ANSI_CONCEAL = ANSI_CSI + '8m'
ANSI_CROSSED_OUT = ANSI_CSI + '9m'

# Foreground colors
ANSI_FG_BLACK = ANSI_CSI + '30m'
ANSI_FG_RED = ANSI_CSI + '31m'
ANSI_FG_GREEN = ANSI_CSI + '32m'
ANSI_FG_YELLOW = ANSI_CSI + '33m'
ANSI_FG_BLUE = ANSI_CSI + '34m'
ANSI_FG_MAGENTA = ANSI_CSI + '35m'
ANSI_FG_CYAN = ANSI_CSI + '36m'
ANSI_FG_WHITE = ANSI_CSI + '37m'
ANSI_FG_DEFAULT = ANSI_CSI + '39m'

# Background colors
ANSI_BG_BLACK = ANSI_CSI + '40m'
ANSI_BG_RED = ANSI_CSI + '41m'
ANSI_BG_GREEN = ANSI_CSI + '42m'
ANSI_BG_YELLOW = ANSI_CSI + '43m'
ANSI_BG_BLUE = ANSI_CSI + '44m'
ANSI_BG_MAGENTA = ANSI_CSI + '45m'
ANSI_BG_CYAN = ANSI_CSI + '46m'
ANSI_BG_WHITE = ANSI_CSI + '47m'
ANSI_BG_DEFAULT = ANSI_CSI + '49m'