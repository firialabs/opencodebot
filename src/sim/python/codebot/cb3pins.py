"""CB3 peripheral pin definitions"""
import board

BTN_0 = board.IO0
LS4_SENS = board.IO1  # Note: in CB2 tradition, reversed from schematic labels.
LS3_SENS = board.IO2
LS2_SENS = board.IO3
LS1_SENS = board.IO4
LS0_SENS = board.IO5
BATT_SENS = board.IO6
EXP_GPIO0 = board.IO7
EXP_GPIO1 = board.IO8
ENC_L_SENS = board.IO9
ENC_R_SENS = board.IO10
I2C_SCL = board.IO11
I2C_SDA = board.IO12
PROX_L = board.IO13
PROX_R = board.IO14
ML_PWM = board.IO15
MR_PWM = board.IO16
SPK_PWM = board.IO17
ACCEL_IRQ = board.IO18
BTN_1 = board.IO21
PROX_PWM = board.IO33
USB_LED = board.IO34
SPI_MOSI = board.IO35
SPI_SCK = board.IO36
SPI_MISO = board.IO37
N_IS_USB = board.IO38
LED_LE = board.IO39
LED_SDI = board.IO40
LED_CLK = board.IO41
LED_OE = board.IO42

# I/O Expander
MOTOR_R_IN2 = 0x02
MOTOR_L_IN1 = 0x04
MOTOR_L_IN2 = 0x08
MOTOR_STBY = 0x10
MOTOR_R_IN1 = 0x20
