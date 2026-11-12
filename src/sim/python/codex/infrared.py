"""Codex infrared transmitter/receiver
"""

import pulseio
import board
import array

class Infrared:
    """ """
    IR_TX_PIN = board.IO9
    IR_RX_PIN = board.IO38

    def __init__(self, power, max_payload=16):
        """Create an Infrared (IR) send/receive driver.

        Args:
            power (codex.Power): Power object from codex module
            max_payload (int): Maximum number of rx bytes "in-flight" or queued.
        """    

        self.msg_queue = []

        # Data transmitted over IR is encoded as a series of timed ON/OFF pulses of the
        # 38kHz infrared "carrier". Our IR sensor (Vishay VSOP38338) has an AGC
        # feature to suppress noise, so we are limited to short data bursts (about 4 bytes).
        # Longer sequences will be perceived as noise and suppressed by the receiver!
        # Note that max_payload is used for receive, so it should be larger than the max tx buffer
        # if you want to queue multiple rx packets between calls to receive().

        # We describe pulses as high-low time ratio pairs (HL). For example "14" means
        # 1 interval high and 4 intervals low, where an interval might be 500uS. The PulseIn
        # class buffers a series of H,L microsecond values which we convert to a string "HLHL..."
        # representation prior to decoding. See below for how we encode HL pulse-width ratios into 
        # binary byte-streams.

        # Calculate PulseIn maxlen based on maximum payload bytes needed.
        # Preamble(1414) + Epilogue (13) needs 6, plus each byte needs 18 (Prefix + 16)
        pulse_buf_max = 6 + (max_payload * 18)
        self._sender = pulseio.PulseOut(Infrared.IR_TX_PIN, frequency=38000, duty_cycle=32768)
        self._reader = pulseio.PulseIn(Infrared.IR_RX_PIN, maxlen=pulse_buf_max)
        self._power = power
        self.max_payload = max_payload

        # Int to ascii for our small range for "HL" values. Way faster than str().
        self._itoa = {1:'1', 2:'2', 3:'3', 4:'4'}

        # Symbols are defined as HL multiples of TPULSE
        self.TPULSE = 500  # pulse unit interval (microseconds)
        self.PREAMBLE = self._pulse_vals((1, 4, 1, 4))
        self.EPILOGUE = self._pulse_vals((1, 3))
        self.BYTE_PREFIX = self._pulse_vals((2, 1))
        self.ONE = self._pulse_vals((1, 2))
        self.ZERO = self._pulse_vals((1, 1))

    def _pulse_vals(self, pulse_ratios):
        # Convert pulse ratios to TPULSE values
        return tuple(map(lambda x: x * self.TPULSE, pulse_ratios))

    def _normalize(self, val):
        # Convert received pulse values to TPULSE units
        return round(val / self.TPULSE)

    def _send(self, data):
        # Transmit message
        # print("sending: ", data)
        pulses = []
        pulses += self.PREAMBLE
        for b in data:
            bits = ord(b)
            pulses += self.BYTE_PREFIX
            number_of_bits = 8
            mask = 1 << number_of_bits
            while number_of_bits > 0:
                mask >>= 1
                if bits & mask:
                    pulses += self.ONE
                else:
                    pulses += self.ZERO
                number_of_bits -= 1

        pulses += self.EPILOGUE
        pulses += self.EPILOGUE

        output_pulses = array.array('H', pulses)
        self._sender.send(output_pulses)

    def _decode_msg(self, msg):
        # Bytes prefixed with 21.  ex: msg="211112111211121112"  0x55
        toks = [msg[i:i+2] for i in range(0,len(msg),2)]
        message = ''
        byte_val = None
        try:
            for t in toks:
                if t == '21':
                    if byte_val != None:
                        message += chr(byte_val)
                    byte_val = 0
                elif t == '11':
                    byte_val = (byte_val << 1)
                elif t == '12':
                    byte_val = (byte_val << 1) + 1
                else:
                    return ''  # Error
            
            message += chr(byte_val)
        except:
            return ''  # Error

        return message

    def _extract_messages(self, s):
        # Split out message payloads, bracketed by 1414___13
        result = []
        start = 0

        while True:
            # Find preamble
            start_idx = s.find('1414', start)
            if start_idx == -1:
                break

            # Find epilogue
            end_idx = s.find('13', start_idx + 4)
            if end_idx == -1:
                break

            # Extract the substring and add it to the result list
            result.append(s[start_idx + 4:end_idx])

            # Update the start index for the next search
            start = end_idx + 2

        return result

    def _receive(self):
        # Decode PulseIn buffer and append messages to queue
        self._power.enable_periph_vcc(True)
        if not len(self._reader) > 23:
            return
        self._reader.pause()
        vals = [self._normalize(self._reader[i]) for i in range(len(self._reader))]
        # print("RX: ", [self._reader[i] for i in range(len(self._reader))])
        self._reader.clear()
        self._reader.resume()
        tok = self._itoa.get
        valstr = ''.join([tok(v, 'e') for v in vals])  # Ex: "14142112111211131"
        msgs = self._extract_messages(valstr)
        decoded = [self._decode_msg(m) for m in msgs]
        self.msg_queue.extend(decoded)

    def receive_queue(self):
        """Get the queue of messages received by the IR receiver

        Returns:
            list : a `list` of `string` messages received (may be empty). Index 0 is oldest.
        """
        self._receive()
        ret = self.msg_queue
        self.msg_queue = []
        return ret

    def receive(self):
        """Get the last `string` (if any) received by the IR receiver

        Returns:
            str : the text received or `None` if nothing has been received
        """
        self._receive()
        if self.msg_queue:
            return self.msg_queue.pop(0)
        else:
            return None

    def send(self, message):
        """Send a message string over infrared.
         
           Size limit in a single message is max_payload defined in __init__() above, but
           due to AGC we recommend limiting to **max 4 characters** per message string.

        Args:
            message (str) : the string to send
        """
        if len(message) > self.max_payload:
            raise ValueError('Message is limited to %d characters' % self.max_payload)
        self._power.enable_periph_vcc(True)
        self._send(message)

    def flush(self):
        """Clear and discard the receive buffer, without decoding it. Can be used after 'send()'
           to avoid receiving "loopback" data.
        """
        self._reader.pause()
        self._reader.clear()
        self._reader.resume()
