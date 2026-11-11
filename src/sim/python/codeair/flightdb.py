"""Flight Controller Database Interface

   Access to the parameter and logging systems on CodeAIR's Crazyflie flight controller.

   See also `flight_lib/flight_lib`

"""

import json
import crtp
import time
import struct
import flight_catalog

SYSLINK_RADIO_RAW           = 0x00
SYSLINK_RADIO_CHANNEL       = 0x01
SYSLINK_RADIO_DATARATE      = 0x02
SYSLINK_RADIO_CONTWAVE      = 0x03
SYSLINK_RADIO_RSSI          = 0x04
SYSLINK_RADIO_ADDRESS       = 0x05
SYSLINK_RADIO_RAW_BROADCAST = 0x06
SYSLINK_RADIO_POWER         = 0x07
SYSLINK_RADIO_P2P           = 0x08
SYSLINK_RADIO_P2P_ACK       = 0x09
SYSLINK_RADIO_P2P_BROADCAST = 0x0A
SYSLINK_PM_SOURCE             = 0x10
SYSLINK_PM_ONOFF_SWITCHOFF    = 0x11
SYSLINK_PM_BATTERY_VOLTAGE    = 0x12
SYSLINK_PM_BATTERY_STATE      = 0x13
SYSLINK_PM_BATTERY_AUTOUPDATE = 0x14
SYSLINK_PM_SHUTDOWN_REQUEST   = 0x15
SYSLINK_PM_SHUTDOWN_ACK       = 0x16
SYSLINK_PM_LED_ON             = 0x17
SYSLINK_PM_LED_OFF            = 0x18
SYSLINK_OW_SCAN         = 0x20
SYSLINK_OW_GETINFO      = 0x21
SYSLINK_OW_READ         = 0x22
SYSLINK_OW_WRITE        = 0x23
SYSLINK_SYS_NRF_VERSION = 0x30
SYSLINK_DEBUG_PROBE     = 0xF0

CRTP_PORT_CONSOLE          = 0x00
CRTP_PORT_PARAM            = 0x02
CRTP_PORT_SETPOINT         = 0x03
CRTP_PORT_MEM              = 0x04
CRTP_PORT_LOG              = 0x05
CRTP_PORT_LOCALIZATION     = 0x06
CRTP_PORT_SETPOINT_GENERIC = 0x07
CRTP_PORT_SETPOINT_HL      = 0x08
CRTP_PORT_PLATFORM         = 0x0D
CRTP_PORT_LINK             = 0x0F

# Log 'type' field
LOG_UINT8  = 1
LOG_UINT16 = 2
LOG_UINT32 = 3
LOG_INT8   = 4
LOG_INT16  = 5
LOG_INT32  = 6
LOG_FLOAT  = 7
LOG_FP16   = 8

log_type_ops = (
    (1, 'B'),
    (2, 'H'),
    (4, 'I'),
    (1, 'b'),
    (2, 'h'),
    (4, 'i'),
    (4, 'f'),
    (2, 'e'),
)

#---- Utility functions ----
def read_crtp(port, channel, timeout_ms=100):
    """Pump raw rx queue from flight controller, return selected data or None if timeout(ms)"""
    for _ in range(int(timeout_ms) / 10):
        pkt = crtp.receive()
        if pkt:
            rport, rchan, rdat = pkt
            if rport == port and rchan == channel:
                return rdat
    return None

toc_cache = {}  # { crc : {group_dot_name: (item_id, item_type)} }
def toc_lookup(toc, crc, group_dot_name):
    # Lookup from toc_param database, cache for future access
    dcache = toc_cache.setdefault(crc, {})
    param = dcache.get(group_dot_name, None)
    if not param:
        group, name = group_dot_name.split('.')
        for index, ptype, pgroup, pname in toc:
            if pgroup == group and pname == name:
                param = (index, ptype)
                dcache[group_dot_name] = param
                break

        if not param:
            print(f"Error: {group_dot_name} not found.")
            return None

    return param


class LogManager:
    """Interface to query the CF logging framework:

       * Retrieve the list of available logging items (TOC) : [(id, type, group, name), ...]
       * Register new logging configs (log blocks)
       * Start/Stop logging
       * Also handle fetching of Param TOC, since logic is identical.

       This class uses :doc:`crtp` to implement the `log interface <https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/functional-areas/crtp/crtp_log/>`_
    """
    # CRTP channels
    TOC_CH      = 0
    CONTROL_CH  = 1
    LOG_CH      = 2

    # Logging system commands. 
    CMD_GET_ITEM_V2 = 2  # V1 was 0
    CMD_GET_INFO_V2 = 3  # V1 was 1
    # CONTROL channel commands respond with data[0]==CONTROL_XX, data[2]==err_code (0=success)
    CONTROL_STOP_BLOCK = 4
    CONTROL_RESET = 5
    CONTROL_CREATE_BLOCK_V2 = 6 # V1 was 0
    CONTROL_APPEND_BLOCK_V2 = 7 # V1 was 1
    CONTROL_START_BLOCK_V2  = 8 # V1 was 3

    def __init__(self):
        self.load_tocs()
        self.expected_toc_count = 0
        self.state = 'IDLE'
        self.cache = {}  # most recent log data {"name": value}
        self.log_blocks = []  # up to 16 blocks of ([id0, id1,...], decode_fmt_str, val_sz)
        self.latest_update_ms = 0
        self.log_rate = 0.1

    def load_tocs(self):
        self.log_toc = flight_catalog.log_toc
        self.log_crc = flight_catalog.log_crc
        self.param_toc = flight_catalog.param_toc
        self.param_crc = flight_catalog.param_crc

    def _err(self, msg):
        print("LOG Error: " + msg)
        self.state = 'IDLE'

    def crtp_rx(self, port, chan, data):
        if port != CRTP_PORT_LOG and port != CRTP_PORT_PARAM:
            return
        
        elif chan == self.TOC_CH:
            # Table of Contents  
            working_toc = self.log_toc if port == CRTP_PORT_LOG else self.param_toc

            if self.state == 'WAIT_INFO':
                if data[0] != self.CMD_GET_INFO_V2:
                    self._err("Unexpected command byte in GET_INFO response")
                    return
                count, crc = struct.unpack_from("<HI", data, 1)
                self.expected_toc_count = count
                # print(f"TOC: got info, count={self.expected_toc_count}, crc=0x{crc:04X}")
                if self.fetch_toc_info_only:
                    self.toc_info = (count, crc)
                    self.state = 'IDLE'
                else:
                    if port == CRTP_PORT_LOG:
                        self.log_crc = crc
                    else:
                        self.param_crc = crc
                
                    # Begin requesting items
                    working_toc.clear()
                    self.get_toc_item(port, 0, True)

            elif self.state.startswith('WAIT_ITEM'):
                if len(data) < 6:
                    self._err(f"Item ID not found in TOC, data={data}")
                    return
                elif data[0] != self.CMD_GET_ITEM_V2:
                    self._err("Unexpected command byte in GET_ITEM response")
                    return
                
                item_id = data[2] << 8 | data[1]
                item_type = data[3] & 0x0F
                strings = data[4:].split(b'\x00', 2)
                item_group = strings[0].decode('utf-8')
                item_name = strings[1].decode('utf-8')
                if self.state == 'WAIT_ITEM':
                    # print(f"TOC item: {(item_id, item_type, item_group, item_name)}")
                    self.state = 'IDLE'
                else:
                    working_toc.append( (item_id, item_type, item_group, item_name) )
                    next_id = len(working_toc)
                    if next_id >= self.expected_toc_count:
                        self.state = 'IDLE'
                    else:
                        self.get_toc_item(port, next_id, True)
        
        elif chan == self.CONTROL_CH:
            if self.state == 'WAIT_CONTROL':
                # Check if response to our send_ctrl_cmd(), invoke callback
                if data[0] == self.ctrl_await_cmd:
                    self.state = 'IDLE'
                    if self.ctrl_cb:
                        self.ctrl_cb(data[2])

    def pump_rx_queue(self, timeout_ms=100):
        t_start = time.ticks_ms()
        while self.state != 'IDLE':
            pkt = crtp.receive()
            if pkt:
                self.crtp_rx(*pkt)
            else:
                time.sleep(0.01)
            
            if time.ticks_diff(time.ticks_ms(), t_start) > timeout_ms:
                self.state = 'IDLE'
                return False

        return True

    def get_toc_item(self, port, id, get_next=False):
        self.state = 'WAIT_ITEM_NEXT' if get_next else 'WAIT_ITEM'
        # print(f"requesting item id={id}")
        crtp.send(port, self.TOC_CH, bytes([self.CMD_GET_ITEM_V2, id & 0xFF, id >> 8]))

    def fetch_toc(self, port, info_only=False):
        """Request TOC info, either PARAM or LOG based on port (CRTP_PORT_LOG or CRTP_PORT_PARAM)"""
        if not (port == CRTP_PORT_LOG or port == CRTP_PORT_PARAM):
            print("Error: port must be CRTP_PORT_LOG(5) or CRTP_PORT_PARAM(2).")
            return False

        self.fetch_toc_info_only = info_only  # If True only update self.toc_info = (count, crc)
        self.state = 'WAIT_INFO'
        crtp.send(port, self.TOC_CH, bytes([self.CMD_GET_INFO_V2]))
        if self.pump_rx_queue(30000):
            # print("TOC fetch complete: %d items" % len(self.log_toc if port == CRTP_PORT_LOG else self.param_toc))
            return True
        else:
            print("TOC fetch timeout.")
            return False

    def check_catalog_crcs(self):
        """Read CRCs from flight controller, return True if they match catalog import"""
        match = True
        self.fetch_toc(CRTP_PORT_LOG, True)
        log_count, log_crc = self.toc_info
        self.fetch_toc(CRTP_PORT_PARAM, True)
        param_count, param_crc = self.toc_info
        if log_count != len(flight_catalog.log_toc) or log_crc != flight_catalog.log_crc:
            print("Log TOC mismatch.")
            match = False
        if param_count != len(flight_catalog.param_toc) or param_crc != flight_catalog.param_crc:
            print("Param TOC mismatch.")
            match = False
        return match

    def generate_catalog(self, filename='new_flight_catalog.py'):
        """Create Python file with log/param TOCs to bake into new CodeAIR builds"""
        # Note: Using json strings because importing plain toc (list of tuples) causes "pystack exhausted" error.
        with open(filename, 'w') as fp:
            print("Fetching log TOC")
            self.fetch_toc(CRTP_PORT_LOG)
            print("Fetching param TOC")
            self.fetch_toc(CRTP_PORT_PARAM)

            fp.write('"""Generated Python Code: Flight Controller parameter and log info catalog"""\r\nimport json\r\n')
            fp.write(f"log_crc = 0x{self.log_crc:04X}\r\nlog_toc = '")
            print("Writing log TOC to file")
            json.dump(self.log_toc, fp)
            fp.write(f"'\r\nlog_toc = json.loads(log_toc)\r\n\r\n")
            fp.write(f"param_crc = 0x{self.param_crc:04X}\r\nparam_toc = '")
            print("Writing param TOC to file")
            json.dump(self.param_toc, fp)
            fp.write(f"'\r\nparam_toc = json.loads(param_toc)\r\n\r\n")
        
        print("Wrote catalog file.")

    def register_items(self, item_list, rate=0.1):
        """Register and start logging the given list of items. Removes all prior logging. Rate is seconds.
           item_list contains strings of form 'group.variable'. 

           Internals:

           * The Crazyflie allows up to 16 "log blocks" to be registered.
           * You register a log block by supplying a list of [TYPE8:ID16] tuples referring to TOC items.
           * The resulting LOG_CH reports for a block must fit within a 30 byte packet, where 4 bytes are consumed
             with [BLK_ID_8, TIMESTAMP_24], leaving 26 bytes cumulative payload for log values. This means the
             max number of IDs you can register in a block depends on the size of the items (8/16/32 bits).
           * Ex: you could register up to 6 32-bit items in a log block.

           Our Python API exposes a single function to register an id_list, hiding the underlying "log block" system.

           * We don't support dynamically appending/deleting discrete blocks. All are created/removed at once.
           * Currently we don't support different rates for different params. The underlying system has a rate for each block.
           * Currently supports only a single log block.

             * TODO: Extend to create up to max (16) blocks to support more log items.
           
           Protocol:

           * CRTP(CRTP_PORT_LOG, CONTROL_CH)
           * Create block: ( CONTROL_CREATE_BLOCK_V2_8, BLK_ID_8, [TYPE_8, ID_16]*n  )
           * Delete all: (CONTROL_RESET)

           Notes:
           Successful registration will initialize -

             .. code-block:: python

                self.cache # {'name': None,...}  # Dict keyed by names from all blocks
                self.log_blocks = [
                        [name0, name1,...],  # list of names in this block
                        decode_fmt_str,  # struct format str for decoding this log block
                        val_sz,   # = struct.calcsize(decode_fmt_str)
                        reg_fields,  # registration fields (packet payload)
                ]

           Returns:
               bool: True if id_list can be registered, False if it would exceed logging payload limits or if list contains an invalid ID.
        """
        # Remove old log blocks
        self.unregister_all()

        MAX_BLOCK_PAYLOAD = 26
        self.log_rate = rate
        self.log_blocks = []

        cur_block_reg = []  # registration fields ([TYPE_8, ID_16]*n)
        cur_block_id = 0 
        cur_block_val_sz = 0
        cur_block_names = []
        cur_block_fmt = '<'

        for name in item_list:
            item = toc_lookup(self.log_toc, self.log_crc, name)
            if item:
                item_id, item_type = item
            else:
                return False
            
            # Found item. Add to cache and register log_block.
            self.cache[name] = None
            val_sz, val_fmt = log_type_ops[item_type - 1]
            if cur_block_val_sz + val_sz > MAX_BLOCK_PAYLOAD:
                # Advance to next block, or error if overflow.
                # TODO: Append cur_block_* to list of block registrations, through up to 16 blocks.
                print(f"Error: Exceeded max cumulative log variable size.")
                return False

            cur_block_names.append(name)
            cur_block_val_sz += val_sz
            cur_block_fmt += val_fmt
            cur_block_reg.extend((item_type, item_id & 0xFF, item_id >> 8))

        # Append last (or only) block
        self.log_blocks.append(
            (cur_block_names, cur_block_fmt, cur_block_val_sz, cur_block_reg)
        )

        # Register block(s)
        for index, b in enumerate(self.log_blocks):
            names, fmt, sz, reg = b
            if False:
                print(f"Create Log Block {index}:")
                print(f"  names={names}")
                reg_record = ' '.join([f'{b:02X}' for b in reg])
                print(f"  reg=[{reg_record}]")
                print(f"  fmt({sz})={fmt}")

            # TODO: Initiate state machine to send CRTP packets, awaiting each response
            # For initial single-block case just send and pray!
            crtp.send(CRTP_PORT_LOG, self.CONTROL_CH, bytes([self.CONTROL_CREATE_BLOCK_V2, index] + reg))

        return True
        
    def enable(self, do_enable):
        """Resume / pause logging. 
           NOTE: Must register_items() FIRST, before enable!
        """
        rate_ms = int(self.log_rate * 1000)
        #TODO: iterate over self.log_blocks. Just one block for now
        index = 0

        # def cmd_ack(err):
        #     print(f"Command ack'd with: {err}")
        cmd_ack = None

        if do_enable:
            self.send_ctrl_cmd(self.CONTROL_START_BLOCK_V2, [index, rate_ms & 0xFF, rate_ms >> 8], cmd_ack)
        else:
            self.send_ctrl_cmd(self.CONTROL_STOP_BLOCK, [index], cmd_ack)
       
    def unregister_all(self):
        """Delete all registered log blocks"""
        self.send_ctrl_cmd(self.CONTROL_RESET, [])

    def send_ctrl_cmd(self, cmd, data, callback=None):
        """Send control channel command, and callback(err_code) upon ACK. Zero means no error."""
        self.ctrl_cb = callback
        self.ctrl_await_cmd = cmd
        self.state = 'WAIT_CONTROL'
        crtp.send(CRTP_PORT_LOG, self.CONTROL_CH, bytes([cmd] + data))
        self.pump_rx_queue()

    def decode_log(self, blk_id, timestamp_ms, data):
        """Decode received log values for this block, updating self.cache.
        """
        if blk_id >= len(self.log_blocks):
            print(f"Error: decoded blk_id={blk_id} out of range!")
            return
        
        # Get list of item ids, and struct format string for this block
        block_items, block_fmt, val_sz, _ = self.log_blocks[blk_id]
        if len(data) != val_sz:
            print(f"Error: block {blk_id} wrong data length (val_sz={val_sz}, data={len(data)}).")

        self.latest_update_ms = timestamp_ms
        vals = struct.unpack(block_fmt, data)

        for index, name in enumerate(block_items):
            self.cache[name] = vals[index]

        # print(f"decode_log @{self.latest_update_ms}ms : {self.cache}")   # DEBUG

    def fetch_log_data(self, timeout_ms=100):
        # Ingest log data from crtp queue, decode, and deposit in self.cache
        for _ in range(int(timeout_ms) / 10):
            log_dat = crtp.log_read()
            if log_dat:
                self.decode_log(*log_dat)
                break
            else:
                time.sleep(0.01)


class ParamManager:
    """Interface to query the CF parameter framework.
       Unlike logging, we don't register for events in the param system.
    """
    # Ordered type format mapping
    types = ('b', 'h', 'i', 'q', 'x', 'e', 'f', 'd', 'B', 'H', 'L', 'Q')

    # Type mapping for set_by_name()
    types_by_name = {
        'U8'  : (0x08, 'B'),
        'U16' : (0x09, 'H'),
        'U32' : (0x0a, 'L'),
        'U64' : (0x0b, 'Q'),
        'I8'  : (0x00, 'b'),
        'I16' : (0x01, 'h'),
        'I32' : (0x02, 'i'),
        'I64' : (0x03, 'q'),
        'F16' : (0x05, 'e'),
        'F32' : (0x06, 'f'),
        'F64' : (0x07, 'd'),
    }

    def __init__(self, log_mgr):
        self.log_mgr = log_mgr  # for the param_toc, param_crc
        self.cache = {}   # group_dot_name: (id, type)

    def set(self, group_dot_name, value):
        """Set parameter based on dotted name, ex: 'motorPowerSet.enable'"""
        param = toc_lookup(self.log_mgr.param_toc, self.log_mgr.param_crc, group_dot_name)
        if not param:
            return

        found_id, found_type = param
        data = struct.pack("<H%c" % self.types[found_type], found_id, value)
        crtp.send(CRTP_PORT_PARAM, 2, data)

    def get(self, group_dot_name):
        """Read parameter. Returns data or None."""
        param = toc_lookup(self.log_mgr.param_toc, self.log_mgr.param_crc, group_dot_name)
        if not param:
            return None
        
        found_id, found_type = param

        # Read param
        data = struct.pack("<H", found_id)
        crtp.flush()
        crtp.send(CRTP_PORT_PARAM, 1, data)

        # Get response
        rdat = read_crtp(CRTP_PORT_PARAM, 1)
        if not rdat:
            print("Error: timeout reading param")
            return None

        # Note: See CF:paramReadProcess(CRTPPacket *p) for packet format detail (differs from docs)
        vals = struct.unpack_from("<HB%c" % self.types[found_type], rdat)
        if vals[0] != found_id:
            print(f"Error: unexpected param id ({vals[0]})")
            return None

        return vals[2]

    def set_by_name(self, group_dot_name, type_id, value):
        """Set param without using TOC lookup (lookup on STM32 instead)"""
        # EX: set_param('motorPowerSet.enable', 'U8', 1)
        # https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/functional-areas/crtp/crtp_parameters/#set-by-name
        name_array = bytes(group_dot_name.replace('.', '\0') + '\0', 'utf-8')
        len_name = len(name_array)
        type_code, type_fmt = self.types_by_name[type_id]
        data = struct.pack(f'<B{len_name}sB{type_fmt}', 0, name_array, type_code, value)
        crtp.send(CRTP_PORT_PARAM, 3, data)

