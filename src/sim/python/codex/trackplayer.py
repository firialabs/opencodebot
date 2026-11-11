"""trackplayer

Simple player: Single track with single voice, using sleep for timing

"""

from time import sleep

DEFAULT_BPM = 60

class TrackPlayer():
    """Player for music tracks"""

    def __init__(self, tone, track=[], bpm=DEFAULT_BPM, articulation = 0.05):
        """Initialize track player
        
        Args:
            tone (sound): A sound from soundlib.SoundMaker.
            track (list): The notes of your song. A list of (pitch, duration) tuples. Units are (Hz, Beats).
            bpm (int): Tempo. The speed of your song in beats-per-minute.
            articulation (float): Articulation gap between notes. The fraction of duration to use as a gap. 0="slur notes together".
        
        """
        self.set_track(track)
        self.tone = tone
        self.set_bpm(bpm)
        self.articulation = articulation

    def set_tone(self, tone):
        """Set a new tone to use for this player.
        
        Args:
            tone (sound): A sound from soundlib.SoundMaker.

        """
        self.tone = tone

    def set_track(self, track):
        """Set a new track list to use for this player.
        
        Args:
            track (list): The notes of your song. A list of (pitch, duration) tuples.

        """
        self.track = track

    def set_bpm(self, bpm):
        """Set a new tempo to use for this player.
        
        Args:
            bpm (int): Tempo. The speed of your song in beats-per-minute.

        """
        self.bpm = bpm
        self.bpm_scalar = DEFAULT_BPM / self.bpm

    def play(self):
        """Play the track! Will block, and return when track is finished playing."""
        index = 0
        count = len(self.track)
        if count == 0:
            self.tone.stop()
            return

        while count > 0:
            pitch, duration = self.track[index]

            # Support adjusting the tempo on the fly
            duration *= self.bpm_scalar

            # Calculate articulation delay
            duration1 = duration * (1 - self.articulation)
            duration2 = duration - duration1

            self.tone.set_pitch(pitch)
            self.tone.play()
            if duration1 > 0:
                sleep(duration1)
            if duration2 > 0:
                self.tone.stop()
                sleep(duration2)
            index += 1
            count -= 1

        self.tone.stop()
