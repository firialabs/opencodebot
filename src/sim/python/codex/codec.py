"""Audio driver functions for CodeX. This provides a Python interface to the
   CodeX ES8311 CODEC (enCOder-DECoder) chip

   See :py:mod:`soundlib` module for a higher-level audio interface.

"""
import board
from codex_drivers import es8311, i2sin
from codex_drivers.funcgen import FuncSample
import busio

import audiomp3
import audiobusio
import audiocore
import board
import array
import time
import math

ES8311_ADDR = 0x18
SAMPLE_FREQ = 16000

# Some ES8311 registers
ES8311_DAC = 0x37

# Equalizer coefficients:
# The actual values are NOT documented by chip vendor Everest,
# but are derived from their graphical configuration tool.
# We have confirmed they really are 30-bit values (not 32-bit)
# There is some evidence that the 30-bits are 6 groups of 5 bits,
# possibly in a sign-bit + 4 data bits format, and some may be bit-flags
ES8311_DACEQ_B0 = 0x38 # First of 4 registers holding a 30-bit EQ value
ES8311_DACEQ_B1 = 0x3C # First of 4 registers holding a 30-bit EQ value
ES8311_DACEQ_A1 = 0x40 # First of 4 registers holding a 30-bit EQ value
# Some bits within those registers
ES8311_DAC_EQBYPASS = 0x08 # DAC Equalizer is bypassed when this bit is set

# FuncSample constants
FT_SINE = 0      #:
FT_SQUARE = 1    #:
FT_SAWTOOTH = 2  #:
FT_TRIANGLE = 3  #:
FT_RANDOM = 4    #:
FT_ORGAN = 5     #:
FT_SYNTH = 6     #:
MOD_FREQUENCY = 0 #:
MOD_AMPLITUDE = 1 #:

class Codec:
    """Access to the audio system of the CodeX (play and record)"""

    def __init__(self, io_expander, power, sample_freq=SAMPLE_FREQ):
        """Initialize ES8311 codec, defaults to DAC mode"""
        self._io_expander = io_expander
        self._power = power
        self._i2c = board.I2C()
        self._i2c.try_lock()
        es8311.init(self._i2c, sample_freq)
        self._i2c.unlock()
        self._i2s = audiobusio.I2SOut(bit_clock=board.IO18, word_select=board.IO17, data=board.IO12)
        self.is_initialized = False
        self.func_sample = None
        self._audio_mixer_inst = None

        if hasattr(self, '__doc__'):
            return  # Autodoc stop here

        # Speaker protection via ES8311 CODEC Equalizer
        # Note that the level only applies when the equalizer is ON
        # Basically we keep it CONFIGURED all the time, and just turn it on/off as-needed
        self.set_bass_level(-20) # Range is 0 to -26. Value of -20 chosen based on single-note sound tests
        if self.is_phones():
            self.enable_dac_equalizer(False) # We want all of the audio
        else:
            self.enable_dac_equalizer(True) # We want to filter out the low-end

    def initialize(self):
        """Enable the audio system and the speaker.

        You can perform these steps manually for fine tuning, but this
        is a quick way to get audio going.
        """
        if self.is_initialized:
            return
        self.is_initialized = True
        if es8311.get_volume() == 0:
            self.set_volume(65)
        self.enable_amp(True)
        self._power.enable_periph_vcc(True)
        self._power.enable_batt_meas(True)   # Mic on
        if not self.func_sample:
            self.make_pitch_func()

    def make_pitch_func(self, func_type=FT_TRIANGLE):
        """Create and set sample function for basic 'pitch()' tone generation.
           Default to triangle waveform, with lovely harmonics so it's louder on
           CodeX little speaker than a pure sine wave.
        """
        self.func_sample = FuncSample(func_type, SAMPLE_FREQ)
        return self.func_sample

    def pitch(self, freq, dur):
        """Play a tone on the speaker, with the specified frequency.

        Args:
          freq (int): Frequency in Hertz
          dur (float): Duration in seconds

        Returns:
          FuncSample: a sample you can optionally control with env_attack(), env_release(), etc.

        """
        self.initialize()
        if not self._i2s.playing:
            self.func_sample.env_release()
            self._i2s.play(self.func_sample, loop=True)

        self.func_sample.set_frequency(freq)
        if dur:
            self.func_sample.env_attack()
            time.sleep(dur)
            self.func_sample.env_release()

        return self.func_sample

    def off(self):
        """Stop ALL output to speaker and headphones.

           Note: For "beeping" on and off it will sound better to use the FuncSample returned
                 from the 'pitch()' function. Or see 'soundlib' module for more advanced features.
        """
        self._i2s.stop()

    def enable_amp(self, do_enable):
        """Enable the audio amplifier for the onboard speaker.
           Allows you to turn OFF the speaker if desired, with headphones
           jack still active.

        Args:
            do_enable (bool) : True to enable or False to disable
        """

        # Audio amp usage implies on-board speaker usage,
        # which implies we want the hardware bass reduction
        self.enable_dac_equalizer(do_enable)

        bits = self._io_expander.get_outputs()
        if do_enable:
            bits |= 1
        else:
            bits = bits & 0b_11111110
        self._io_expander.set_outputs(bits)

    def is_amp_enabled(self):
        """Return the status of the audio amplifier.

        Returns:
            bool : True if the amplifier is enabled
        """
        return bool(self._io_expander.get_outputs() & 1)

    def set_volume(self, volume):
        """Set the output audio volume

        Args:
            volume (int) : volume from 0 to 100 percent
        """
        es8311.set_volume(volume)

    def get_volume(self):
        """Get the output audio volume

        Returns:
            int : volume from 0 to 100 percent
        """
        return es8311.get_volume()

    def is_phones(self):
        """Are headphones plugged in?

        Returns:
            bool : True if headphones are detected
        """
        return not self._io_expander.get_input(6)

    def get_chip_id(self):
        """Get the chip ID of ES8311"""
        self._i2c.try_lock()
        ret = es8311.chip_id()
        self._i2c.unlock()
        return ret

    def _ping(self):
        """Read es8311 chip ID @ reg 0xFD --> 0x83

        This is an example of using CircuitPython I2C to directly communicate with ES8311.
        """
        self._i2c.try_lock()
        self._i2c.writeto(ES8311_ADDR, bytes([0xFD]))

        result = bytearray(1)
        self._i2c.readfrom_into(ES8311_ADDR, result)
        print(f'es8311 ID: {result}')

        self._i2c.unlock()

    def mic_gain(self, pga=0x10, adc=0xbf):
        """Set the microphone gain

        Args:
            pga (int) : PGA gain
            adc (int) : ADC volume
        """
        es8311.write_reg(0x14, pga)   # PGA gain (0x10=0dB, 0x1A=30dB)
        es8311.write_reg(0x17, adc)   # ADC volume (0xBF=0dB)

    # Reasonable gain values for CodeX mic
    def record(self, duration=2.0, sample_freq=SAMPLE_FREQ, pga_gain=0x12, adc_gain=0xd0):
        """Record from ADC (microphone), returning a 16-bit array of samples.

           Note: All samples must fit in a single RAM buffer, so be careful with RAM management.
                (ESP32S2 WROVER module has 2M bytes of RAM available total)
        """
        self.initialize()
        length = int(sample_freq * duration)
        buf = array.array("h", [0] * length)
        #print("Init for recording.")

        self.mic_gain(pga_gain, adc_gain)

        # More research is required into how to get I2SIN and I2SOUT to coexist
        # Today's work-around is to take down the I2SOUT during recording,
        # then put it back afterwards
        self._i2s.stop()
        self._i2s.deinit()

        # Enable ESP32 I2S input (start generating BCLK, filling DMA buffers)
        result = i2sin.init(sample_freq)
        if result == 0:
            # Setup the codec
            es8311.set_adc_dac(True)  # ADC mode

            #print("Start recording...")

            # Read samples from DMA buffers until timeout or empty
            i2sin.readinto(buf, int(duration * 1000))  # convert secs to milliseconds

            #print("Recording done.")

            es8311.set_adc_dac(False)  # return to DAC mode

            i2sin.deinit()  # Stop clocking I2S data

        self._i2s = audiobusio.I2SOut(bit_clock=board.IO18, word_select=board.IO17, data=board.IO12)
        
        # Restart background audio mixer sample stream if set
        if self._audio_mixer_inst:
            self._i2s.play(self._audio_mixer_inst)

        return buf

    def set_audio_mixer(self, mixer):
        self._audio_mixer_inst = mixer
        self._i2s.play(mixer)

    def playbuf(self, buf, sample_freq=SAMPLE_FREQ, loop=False):
        """Play 'buf' via I2SOut. Works with array returned from record(), 
           or any 16-bit array you create using array.array("h") and fill with samples.
        """
        self.initialize()
        duration = len(buf) / sample_freq
        sample_buf = audiocore.RawSample(buf, channel_count=1, sample_rate=sample_freq)

        self._i2s.play(sample_buf, loop=True)
        if not loop:
            time.sleep(duration)
            self._i2s.stop()

    def wav(self, filename):
        """Play given WAV file
        
        Args:
            filename (str) : Path and name of file (.wav extension is optional)

        """
        if not filename.endswith('.wav'):
            filename += '.wav'

        with open(filename, "rb") as sf:
            w = audiocore.WaveFile(sf)
            self.initialize()
            self._i2s.play(w, loop=False)
            while self._i2s.playing:
                time.sleep(0.1)

    def mp3(self, filename):
        """Play given MP3 file. 

        Args:
            filename (str) : Path and name of file (.mp3 extension is optional)
        """
        if not filename.endswith('.mp3'):
            filename += '.mp3'

        with open(filename, "rb") as sf:
            w = audiomp3.MP3Decoder(sf)
            self.initialize()
            self._i2s.play(w, loop=False)
            while self._i2s.playing:
                time.sleep(0.1)

    def enable_dac_equalizer(self, do_enable):
        """Enable the output-side (DAC) equalizer in the ES8311 CODEC.

        Args:
            do_enable (bool) : True to enable or False to disable
        """

        register_value = es8311.read_reg(ES8311_DAC)

        # It's a BYPASS bit in the register, not an ENABLE bit
        # That is why the logic below might seem backwards...
        if do_enable:
            register_value &= ~ES8311_DAC_EQBYPASS
        else:
            register_value |= ES8311_DAC_EQBYPASS
        es8311.write_reg(ES8311_DAC, register_value)

    def _set_30_bits(self, starting_register, value):
        """Internal helper function used to set 30-bit values that span 4 consecutive registers"""
        byte4 = value & 0xFF
        value >>= 8
        byte3 = value & 0xFF
        value >>= 8
        byte2 = value & 0xFF
        value >>= 8
        byte1 = value & 0x3F
        es8311.write_reg(starting_register, byte1)
        es8311.write_reg(starting_register+1, byte2)
        es8311.write_reg(starting_register+2, byte3)
        es8311.write_reg(starting_register+3, byte4)

    def _set_DACEQ_B0(self, value):
        """Internal helper function to set DAC Equalizer coefficient B0"""
        self._set_30_bits(ES8311_DACEQ_B0, value)

    def _set_DACEQ_B1(self, value):
        """Internal helper function to set DAC Equalizer coefficient B1"""
        self._set_30_bits(ES8311_DACEQ_B1, value)

    def _set_DACEQ_A1(self, value):
        """Internal helper function to set DAC Equalizer coefficient A1"""
        self._set_30_bits(ES8311_DACEQ_A1, value)

    def _set_DAC_EQ(self, B0, B1, A1):
        """Internal helper function to set the DAC Equalizer coefficients B0, B1, and A1"""
        self._set_DACEQ_B0(B0)
        self._set_DACEQ_B1(B1)
        self._set_DACEQ_A1(A1)

    # The point of this routine is to protect our little speaker
    # You will notice that we only support LOWERING the bass level
    def set_bass_level(self, gain):
        """Adjust the low-frequency (bass) audio gain for the audio output.

        Args:
            gain (integer) : 0 to -26 dB
        """
        # These magic filter coefficients came from a proprietary EVEREST
        # tool, and they refused to provide any technical details.
        # This particular set has a lot of redundancy, but in general this
        # is not the case with the EVEREST tool, and so I have kept the code generic
        FILTER_COEFFICIENTS = [
            (0xf7fdff, 0x203a5fdF, 0x0132b7cf), # bass FS=16000 FC=0.25 G=0 dB
            (0xf7fdff, 0x203a5fdF, 0x0133217d), # bass FS=16000 FC=0.25 G=-1 dB
            (0xf7fdff, 0x203a5fdF, 0x0133e97c), # bass FS=16000 FC=0.25 G=-2 dB
            (0xf7fdff, 0x203a5fdF, 0x0121dd6f), # bass FS=16000 FC=0.25 G=-3 dB
            (0xf7fdff, 0x203a5fdF, 0x0121d4d7), # bass FS=16000 FC=0.25 G=-4 dB
            (0xf7fdff, 0x203a5fdF, 0x0122190a), # bass FS=16000 FC=0.25 G=-5 dB
            (0xf7fdff, 0x203a5fdF, 0x01222d9d), # bass FS=16000 FC=0.25 G=-6 dB
            (0xf7fdff, 0x203a5fdF, 0x01229d4c), # bass FS=16000 FC=0.25 G=-7 dB
            (0xf7fdff, 0x203a5fdF, 0x012369bf), # bass FS=16000 FC=0.25 G=-8 dB
            (0xf7fdff, 0x203a5fdF, 0x022b276c), # bass FS=16000 FC=0.25 G=-9 dB
            (0xf7fdff, 0x203a5fdF, 0x022a196c), # bass FS=16000 FC=0.25 G=-10 dB
            (0xf7fdff, 0x203a5fdF, 0x02329d1b), # bass FS=16000 FC=0.25 G=-11 dB
            (0xf7fdff, 0x203a5fdF, 0x0234b3ae), # bass FS=16000 FC=0.25 G=-12 dB
            (0xf7fdff, 0x203a5fdF, 0x0243236d), # bass FS=16000 FC=0.25 G=-13 dB
            (0xf7fdff, 0x203a5fdF, 0x025d31bf), # bass FS=16000 FC=0.25 G=-14 dB
            (0xf7fdff, 0x203a5fdF, 0x03542d9e), # bass FS=16000 FC=0.25 G=-15 dB
            (0xf7fdff, 0x203a5fdF, 0x0332a55d), # bass FS=16000 FC=0.25 G=-16 dB
            (0xf7fdff, 0x203a5fdF, 0x0442dd4e), # bass FS=16000 FC=0.25 G=-17 dB
            (0xf7fdff, 0x203a5fdF, 0x047cb3cf), # bass FS=16000 FC=0.25 G=-18 dB
            (0xf7fdff, 0x203a5fdF, 0x0653a98f), # bass FS=16000 FC=0.25 G=-19 dB
            (0xf7fdff, 0x203a5fdF, 0x08af3dff), # bass FS=16000 FC=0.25 G=-20 dB
            (0xf7fdff, 0x203a5fdF, 0x286ba1ff), # bass FS=16000 FC=0.25 G=-21 dB
            (0xf7fdff, 0x203a5fdF, 0x27435d5c), # bass FS=16000 FC=0.25 G=-22 dB
            (0xf7fdff, 0x203a5fdF, 0x254be77d), # bass FS=16000 FC=0.25 G=-23 dB
            (0xf7fdff, 0x203a5fdF, 0x225b37cf), # bass FS=16000 FC=0.25 G=-24 dB
            (0xf7fdff, 0x203a5fdF, 0x233adf5b), # bass FS=16000 FC=0.25 G=-25 dB
            (0xf7fdff, 0x203a5fdF, 0x20299f5b) # bass FS=16000 FC=0.25 G=-26 dB
        ]

        if gain > 0:
            return
        if gain < -26:
            return
        coefficients = FILTER_COEFFICIENTS[-gain]
        B0 = coefficients[0]
        B1 = coefficients[1]
        A1 = coefficients[2]

        self._set_DAC_EQ(B0, B1, A1)
