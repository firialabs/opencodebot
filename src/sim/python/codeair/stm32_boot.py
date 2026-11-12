"""Implementation of STM32 bootloader interface.

Usage:
  st = STM32boot()
  st.enter_boot()    # returns True if successful
  st.get_version()   # returns 0x31  => Version 3.1
  st.mass_erase()    # returns True after ~16 seconds
  st.write_flash('codeair.bin')  # returns True after ~34 seconds
  st.exit_boot()     # exits BOOT mode and resets STM32

"""
import busio
import board
import digitalio
import time

# Bootloader commands
ST_TRAP = 0x7F
ST_ACK = 0x79
ST_NACK = 0x1F
ST_GET = 0x00
ST_GET_VER = 0x01
ST_GET_ID = 0x02
ST_RD_MEM = 0x11
ST_GO = 0x21
ST_WR_MEM = 0x31
ST_ERASE = 0x43
ST_EXT_ERASE = 0x44
ST_SPECIAL = 0x50
ST_EXT_SPECIAL = 0x51
ST_WR_PROT = 0x63
ST_WR_UNPROT = 0x73
ST_RD_PROT = 0x82
ST_RD_UNPROT = 0x92
ST_GET_CSUM = 0xA1

RX_ACK = bytes((ST_ACK,))

class STM32boot:
    def __init__(self, cb=None):
        # Optional callback to provide a progress update.
        # If provided, callback takes one param (0=read, else a command code)
        self.cb = cb if cb else lambda x : None

        ESP_TX = board.D47
        ESP_RX = board.D21
        STM_NRST = board.D33
        STM_BOOT = board.D12

        self.nrst = digitalio.DigitalInOut(STM_NRST)
        self.nrst.direction = digitalio.Direction.OUTPUT
        self.nrst.value = 1

        self.boot = digitalio.DigitalInOut(STM_BOOT)
        self.boot.direction = digitalio.Direction.OUTPUT
        self.boot.value = 1

        self._uart = busio.UART(ESP_TX, ESP_RX, baudrate=115200, parity=busio.UART.Parity.EVEN, timeout=1.0)

    def deinit(self):
        self._uart.deinit()
        self.boot.deinit()
        self.nrst.deinit()
    
    def xor_checksum(self, data):
        checksum = 0
        for byte in data:
            checksum ^= byte
        return checksum.to_bytes(1, 'big')

    def enter_boot(self):
        self.boot.value = 1
        self.nrst.value = 0
        time.sleep(0.1)
        self.nrst.value = 1
        time.sleep(0.1)
        self._uart.reset_input_buffer()
        self._uart.write(bytes((ST_TRAP,)))
        resp = self.read(1)
        if resp == RX_ACK:
            return True
        return False

    def exit_boot(self):
        self.nrst.value = 0
        self.boot.value = 0
        time.sleep(0.1)
        self.nrst.value = 1
        time.sleep(0.1)

    def cmd(self, code):
        self.cb(code)
        self._uart.reset_input_buffer()
        txb = bytes((code, 0xff & ~code))
        self._uart.write(txb)

    def read(self, max_bytes):
        rxb = self._uart.read(max_bytes)
        if rxb is None:
            self.cb(0)
        return rxb
    
    def get_version(self):
        ver = 0
        self.cmd(ST_GET_VER)  # expect: ACK, Ver, 0, 0, ACK

        rxb = self.read(5)
        if len(rxb) == 5 and rxb[0] == ST_ACK and rxb[4] == ST_ACK:
            ver = rxb[1]
        
        return ver

    def mass_erase(self, timeout=20):
        """Takes about 16 seconds for STM32F405"""
        self.cmd(ST_EXT_ERASE)
        rxb = self.read(1)
        if rxb == RX_ACK:
            self._uart.write(bytes((0xff, 0xff, 0x00)))
            for _ in range(timeout):
                if self.read(1) == RX_ACK:
                    return True
        return False

    def write_block(self, addr, buf, timeout=20):
        """Write up to 256 bytes"""
        self.cmd(ST_WR_MEM)
        rxb = self.read(1)
        if rxb == RX_ACK:
            # Start address (4-bytes big-endian)
            addr_bytes = addr.to_bytes(4, 'big')
            addr_csum = self.xor_checksum(addr_bytes)
            self._uart.write(addr_bytes)
            self._uart.write(addr_csum)
            rxb = self.read(1)
            if rxb == RX_ACK:
                # (Length - 1) followed by data. Note: length must be multiple of 4
                dat = (len(buf) - 1).to_bytes(1,'big') + buf
                dat_csum = self.xor_checksum(dat)
                self._uart.write(dat)
                self._uart.write(dat_csum)

                for _ in range(timeout):
                    if self.read(1) == RX_ACK:
                        return True
                    
        return False

    def write_flash(self, file):
        """Write flash, given file object or filename"""
        addr = 0x08000000
        blk_sz = 256

        if not hasattr(file, 'read'):
            file = open(file, 'rb')

        with file as fp:
            while True:
                # Read 256 byte blocks
                blk = fp.read(blk_sz)
                nread = len(blk)

                if nread:
                    if nread < blk_sz:
                        # Pad blocks to full size
                        blk += b'\xff' * (blk_sz - nread)

                    stat = self.write_block(addr, blk)
                    if not stat:
                        print("Error writing block")
                        return False
                    
                if nread == blk_sz:
                    addr += blk_sz
                else:
                    # EOF
                    break
        return True

    def send_val(self, val, n_bytes=4):
        val_bytes = val.to_bytes(n_bytes, 'big')
        val_csum = self.xor_checksum(val_bytes)
        self._uart.write(val_bytes)
        self._uart.write(val_csum)
        return self.read(1) == RX_ACK

    def get_flash_crc(self, length, timeout=10):
        """This only works for bootloaders v3.3 and later. Our STM32F405 is v3.1"""
        addr = 0x08000000
        crc_poly = 0x04C11DB7  # standard CRC-32 (CRC-32/ISO-HDLC or Ethernet) 
        crc_init = 0xFFFFFFFF
        num_words = length // 4

        self.cmd(ST_GET_CSUM)
        rxb = self.read(1)
        if rxb == RX_ACK:
            # Start address (4-bytes big-endian)
            if self.send_val(addr) and      \
               self.send_val(num_words) and \
               self.send_val(crc_poly) and  \
               self.send_val(crc_init):

                for _ in range(timeout):
                    if self.read(1) == RX_ACK:
                        data = self.read(5)
                        if len(data) == 5 and data[4] == ST_ACK:
                            crc_bytes = data[:4]
                            crc = int.from_bytes(crc_bytes, 'big')
                            return crc
        else:
            print("CRC not supported in this bootloader.")
        
        return 0  # error
