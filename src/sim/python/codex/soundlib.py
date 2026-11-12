"""soundlib (including SoundMaker, Tone)

This library provides a high-level interface for playing and mixing sounds of different types
on the CodeX. With this, sounds can also be played "in the background" while other code runs.

    * soundmaker = `SoundMaker`
    
    Example:
        Play a tone based on a supported instrument or waveform name

        >>> tone = soundlib.get_tone('trumpet')
        >>> tone.play()

.. list-table::
   :header-rows: 1

   * - Instrument
     - Waveform
   * - flute
     - sine
   * - recorder
     - triangle
   * - trumpet
     - square
   * - violin
     - sawtooth
   * - noise
     - random
   * - organ
     - (none)
   * - synth
     - see :py:meth:`set_synthbuf() <soundlib.Tone.set_synthbuf>`

"""

import codex
import audiocore
import audiomixer
import audiomp3

from codex_drivers.funcgen import FuncSample

STANDARD_SAMPLE_RATE = 16000

#
# This class is intended to make things simple, and helps out
# automagically where it can. See for example set_level().
# Tone gives the user a single object to manipulate, versus
# having to deal with both a MixerVoice and a RawSample.
# This class is normally used in combination with the SoundMaker class.
#
class Tone():
    """A Tone player with pitch and level control. Tones have variable pitch (frequency),
       and support several different wave shapes (waveforms).

       This is built atop the FuncSample class in the :py:mod:`funcgen` module. See that module for 
       more details.

    """

    # Associate familiar sound names to wave shapes
    aliases = {
        "flute" : "sine",
        "recorder" : "triangle",
        "trumpet" : "square",
        "violin" : "sawtooth",
        "noise" : "random",
    }

    func_types = {
        "sine": 0,
        "square": 1,
        "triangle": 2,
        "sawtooth": 3,
        "random": 4,
        "organ": 5,
        "synth": 6,
    }

    modulator_types = {
        "fm": 0,
        "am": 1,
    }

    def __init__(self, voice, sample):
        """Tone uses an audiomixer voice to play a FuncSample sample."""
        self.voice = voice
        self.sample = sample
        # The following is for the automagic level control
        self.active_voices = 1 # default to assuming we are the only one
        self.set_pitch(440)
        self.sample.env_release()
        self.voice_play()

    def _set_active_voices(self, quantity):
        """Used by SoundMaker to enforce reasonable sound levels"""
        relative_volume = self.voice.level
        level = relative_volume * self.active_voices
        self.active_voices = quantity
        relative_volume = level / self.active_voices
        self.voice.level = relative_volume

    def play(self):
        """Start tone. Use envelope to avoid clicking and provide soft note-shaping."""
        self.voice_play()  # in case mixer voice has been stopped (e.g. record mode)
        self.sample.env_attack()

    def stop(self):
        """Stop tone. Use envelope to avoid clicking and provide soft note-shaping."""
        self.sample.env_release()

    def voice_stop(self):
        """Turn off this mixer voice (abruptly, can 'click')"""
        self.voice.stop()

    def voice_play(self):
        """Turn on this mixer voice (abruptly, can 'click')"""
        if not self.voice.playing:
            self.voice.play(self.sample, loop=True)

    def set_pitch(self, value):
        """Set pitch to the specified value (in Hertz)"""
        self.sample.set_frequency(value)
        self.pitch = value

    def glide(self, new_pitch, duration):
        """Glide from current frequency to new pitch, linearly over tm seconds.
        
        Args:
            pitch (float): Target frequency (Hz)
            tm (float): Duration of glide (time to reach target pitch)
        """
        self.sample.glide(new_pitch, duration)

    def set_level(self, value):
        """Set volume level to the specified relative value (0-100)"""
        # This API works in percent 0-100 but the underlying library works in 0.0-1.0 units
        value /= 100.0
        # Maintain our automatic level adjustment. For example, if there are two voices
        # and you ask for 100%, what you get is 50% of the total available
        value /= self.active_voices
        self.voice.level = value

    def set_wave(self, wave_name):
        """Set waveform to specified type (from func_types or aliases)"""
        self.sample.set_function(self.wave_func(wave_name))

    def set_synthbuf(self, array_buf):
        """For "synth" waveform type, set the source array: 1-cycle of 16-bit samples.

           The array can be any length, and will be assumed to contain exactly one cycle.
           Create with: array_buf = array.array("h", [0] * length)
        """
        self.sample.set_synthbuf(array_buf)

    @staticmethod
    def wave_func(wave_name):
        """Return the FuncGen code corresponding to wave_name."""
        if wave_name in Tone.aliases:
            wave_name = Tone.aliases[wave_name]
        
        # Default to sine wave if no match
        return Tone.func_types.get(wave_name, 0)

    def set_envelope(self, a, d, s, r):
        """Configure envelope parameters. 
        Initial settings are: (0.003, 0.010, 0.95, 0.003)
        
        Args:
            a (float): Attack (sec) - time from 0 to full amplitude
            d (float): Decay (sec) - time from full to Sustain amplitude
            s (float): Sustain (fraction) - proportion of full amplitude to hold
            r (float): Release (sec) - time from Sustain to 0 amplitude
        """
        self.sample.set_envelope(a, d, s, r)

    def set_modulator(self, mod_name, rate, depth_buf):
        """Configure a modulator (LFO)

           The supplied depth_buf must have nonzero length and will be assumed to 
           represent exactly 1-cycle of the LFO waveform.

           Each modulator has its own independent LFO.

        Args:
            mod_name (str): Which modulator ("fm", "am")
            rate (float): LFO frequency (Hz). set to ZERO to disable modulator.
            depth_buf (array("h")): Array of 16-bit signed samples
        """
        param = self.modulator_types.get(mod_name, 0)  # default to "fm"
        self.sample.set_modulator(param, rate, depth_buf)
    

#
# The point of this helper class it to make MP3 file playback work similar
# to the Tone class
#
class MP3():
    """A MP3 player with level control"""
    def __init__(self, voice, filename):
        self.voice = voice

        # The following is for the automagic level control
        self.active_voices = 1 # default to assuming we are the only one

        try:
            if not filename.endswith('.mp3'):
                filename += '.mp3'

            self.mp3_file = open(filename, "rb")
            try:
                self.mp3_decoder = audiomp3.MP3Decoder(self.mp3_file)
            except:
                print(str(filename) + " is not a valid MP3 file")
        except:
            print(str(filename) + " is not a valid file")

    def _set_active_voices(self, quantity):
        """Used by SoundMaker to enforce reasonable sound levels"""
        relative_volume = self.voice.level
        level = relative_volume * self.active_voices
        self.active_voices = quantity
        relative_volume = level / self.active_voices
        self.voice.level = relative_volume

    def stop(self):
        """Stop generating sound (be quiet)"""
        self.voice.stop()

    def play(self, loop=False):
        """Begin generating sound"""
        self.voice.play(self.mp3_decoder, loop=loop)

    def set_level(self, value):
        """Start volume level to the specified relative value (0-100)"""
        # This API works in percent 0-100 but the underlying library works in 0.0-1.0 units
        value /= 100.0
        # Maintain our automatic level adjustment. For example, if there are two voices
        # and you ask for 100%, what you get is 50% of the total available
        value /= self.active_voices
        self.voice.level = value

#
# The point of this helper class it to make WAV file playback work similar
# to the Tone class
#
class WAV():
    """A WAV player with level control"""
    def __init__(self, voice, filename):
        self.voice = voice

        # The following is for the automagic level control
        self.active_voices = 1 # default to assuming we are the only one

        try:
            self.wav_file = open(filename, "rb")
            try:
                self.wav_decoder = audiocore.WaveFile(self.wav_file)
            except:
                print(str(filename) + " is not a valid WAV file")
        except:
            print(str(filename) + " is not a valid file")

    def _set_active_voices(self, quantity):
        """Used by SoundMaker to enforce reasonable sound levels"""
        relative_volume = self.voice.level
        level = relative_volume * self.active_voices
        self.active_voices = quantity
        relative_volume = level / self.active_voices
        self.voice.level = relative_volume

    def stop(self):
        """Stop generating sound (be quiet)"""
        self.voice.stop()

    def play(self, loop=False):
        """Begin generating sound"""
        self.voice.play(self.wav_decoder, loop=loop)

    def set_level(self, value):
        """Start volume level to the specified relative value (0-100)"""
        # This API works in percent 0-100 but the underlying library works in 0.0-1.0 units
        value /= 100.0
        # Maintain our automatic level adjustment. For example, if there are two voices
        # and you ask for 100%, what you get is 50% of the total available
        value /= self.active_voices
        self.voice.level = value

class Sample():
    """A sample player with level control"""
    def __init__(self, voice, sample):
        self.voice = voice
        self.sample = sample

        # The following is for the automagic level control
        self.active_voices = 1 # default to assuming we are the only one

    def _set_active_voices(self, quantity):
        """Used by SoundMaker to enforce reasonable sound levels"""
        relative_volume = self.voice.level
        level = relative_volume * self.active_voices
        self.active_voices = quantity
        relative_volume = level / self.active_voices
        self.voice.level = relative_volume

    def stop(self):
        """Stop generating sound (be quiet)"""
        self.voice.stop()

    def play(self, loop=False):
        """Begin (or resume if stop() was called) generating sound"""
        if not self.voice.playing:
            self.voice.play(self.sample, loop=loop)

    def set_level(self, value):
        """Start volume level to the specified relative value (0-100)"""
        # This API works in percent 0-100 but the underlying library works in 0.0-1.0 units
        value /= 100.0
        # Maintain our automatic level adjustment. For example, if there are two voices
        # and you ask for 100%, what you get is 50% of the total available
        value /= self.active_voices
        self.voice.level = value

class SoundMaker():
    """Provides sounds which can be mixed together concurrently (polyphonic!)"""
    def __init__(self, max_concurrent_sounds=16, sample_rate=STANDARD_SAMPLE_RATE):
        if hasattr(self, '__doc__'):
            return  # Autodoc stop here

        self.max_sounds = max_concurrent_sounds
        self.sample_rate = sample_rate
        self.sounds_in_use = 0
        self.players = []
        self.mixer = audiomixer.Mixer(voice_count=self.max_sounds, sample_rate=self.sample_rate, channel_count=1, bits_per_sample=16, samples_signed=True)
        codex.audio.initialize()
        codex.audio.set_audio_mixer(self.mixer)

    def get_tone(self, waveform_name="sine"):
        """Get a Tone object so you can make some noise!"""
        if self.sounds_in_use >= self.max_sounds:
            print("Maximum requested number of sounds exceeded")
            return None
        
        ft = Tone.wave_func(waveform_name)
        sample = FuncSample(ft, self.sample_rate)

        tone = Tone(self.mixer.voice[self.sounds_in_use], sample)
        self.add_sound(tone)

        return tone

    def get_sample(self, sample_buf, play=True, loop=False):
        """Get a sample object so you can play it. This can be a buffer directly recorded from the CodeX mic,
           or any 16-bit array you create using `array.array` ("h") and fill with samples.
           Note: sample rate of sample_buf must match self.sample_rate or pitch will be wonky!
        """
        if self.sounds_in_use >= self.max_sounds:
            print("Maximum requested number of sounds exceeded")
            return None

        raw_sample = audiocore.RawSample(sample_buf, channel_count=1, sample_rate=self.sample_rate)
        sample = Sample(self.mixer.voice[self.sounds_in_use], raw_sample)
        self.add_sound(sample)

        if play:
            sample.play(loop)

        return sample

    def get_mp3(self, filename, play=True, loop=False):
        """Get a MP3 object so you can play it"""
        if self.sounds_in_use >= self.max_sounds:
            print("Maximum requested number of sounds exceeded")
            return None

        mp3 = MP3(self.mixer.voice[self.sounds_in_use], filename)
        self.add_sound(mp3)

        if play:
            mp3.play(loop)

        return mp3

    def get_wav(self, filename, play=True, loop=False):
        """Get a WAV object so you can play it"""
        if self.sounds_in_use >= self.max_sounds:
            print("Maximum requested number of sounds exceeded")
            return None

        wav = WAV(self.mixer.voice[self.sounds_in_use], filename)
        self.add_sound(wav)

        if play:
            wav.play(loop)

        return wav

    def add_sound(self, sound):
        self.players.append(sound)

        self.sounds_in_use += 1

        # Automatically reduce level (volume) settings
        for index in range(self.sounds_in_use):
            self.players[index]._set_active_voices(self.sounds_in_use)

    def stop(self):
        """Invoke the stop() command on all the active sound players"""
        for index in range(self.sounds_in_use):
            self.players[index].stop()

    def play(self, loop=False):
        """Invoke the play() command on all the active sound players"""
        for index in range(self.sounds_in_use):
            self.players[index].play(loop)

    def reset(self):
        """Stop and remove all mixer voices."""
        for i in range(self.max_sounds):
            self.mixer.stop_voice(i)
        
        self.sounds_in_use = 0
        self.players = []


# Create the global SoundMaker instance
soundmaker = SoundMaker()
