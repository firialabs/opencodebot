"""songplayer module

Very high-level text-based music player
Both songs and voices are specified as text strings

Uses a TrackPlayer for the actual playback.
The focus in this module is on translating from a text-based format
into the simple format used by TrackPlayer, and on doing as much of the
setup as possible for the user.

    * song_player = `SongPlayer`


"""

from soundlib import *

from trackplayer import *

NOTES = {
  'C1'  : 261.63 / 8,
  'C#1' : 277.18 / 8,
  'Db1' : 277.18 / 8,
  'D1'  : 293.66 / 8,
  'D#1' : 311.13 / 8,
  'Eb1' : 311.13 / 8,
  'E1'  : 329.63 / 8,
  'F1'  : 349.23 / 8,
  'F#1' : 369.99 / 8,
  'Gb1' : 369.99 / 8,
  'G1'  : 392.00 / 8,
  'G#1' : 415.30 / 8,
  'Ab1' : 415.30 / 8,
  'A1'  : 440.00 / 8,
  'A#1' : 466.16 / 8,
  'B1'  : 493.88 / 8,
  'C2'  : 261.63 / 4,
  'C#2' : 277.18 / 4,
  'Db2' : 277.18 / 4,
  'D2'  : 293.66 / 4,
  'D#2' : 311.13 / 4,
  'Eb2' : 311.13 / 4,
  'E2'  : 329.63 / 4,
  'F2'  : 349.23 / 4,
  'F#2' : 369.99 / 4,
  'Gb2' : 369.99 / 4,
  'G2'  : 392.00 / 4,
  'G#2' : 415.30 / 4,
  'Ab2' : 415.30 / 4,
  'A2'  : 440.00 / 4,
  'A#2' : 466.16 / 4,
  'B2'  : 493.88 / 4,
  'C3'  : 261.63 / 2,
  'C#3' : 277.18 / 2,
  'Db3' : 277.18 / 2,
  'D3'  : 293.66 / 2,
  'D#3' : 311.13 / 2,
  'Eb3' : 311.13 / 2,
  'E3'  : 329.63 / 2,
  'F3'  : 349.23 / 2,
  'F#3' : 369.99 / 2,
  'Gb3' : 369.99 / 2,
  'G3'  : 392.00 / 2,
  'G#3' : 415.30 / 2,
  'Ab3' : 415.30 / 2,
  'A3'  : 440.00 / 2,
  'A#3' : 466.16 / 2,
  'B3'  : 493.88 / 2,
  'C4'  : 261.63,
  'C#4' : 277.18,
  'Db4' : 277.18,
  'D4'  : 293.66,
  'D#4' : 311.13,
  'Eb4' : 311.13,
  'E4'  : 329.63,
  'F4'  : 349.23,
  'F#4' : 369.99,
  'Gb4' : 369.99,
  'G4'  : 392.00,
  'G#4' : 415.30,
  'Ab4' : 415.30,
  'A4'  : 440.00,
  'A#4' : 466.16,
  'Bb4' : 466.16,
  'B4'  : 493.88,
  'C5'  : 261.63 * 2,
  'C#5' : 277.18 * 2,
  'Db5' : 277.18 * 2,
  'D5'  : 293.66 * 2,
  'D#5' : 311.13 * 2,
  'Eb5' : 311.13 * 2,
  'E5'  : 329.63 * 2,
  'F5'  : 349.23 * 2,
  'F#5' : 369.99 * 2,
  'Gb5' : 369.99 * 2,
  'G5'  : 392.00 * 2,
  'G#5' : 415.30 * 2,
  'Ab5' : 415.30 * 2,
  'A5'  : 440.00 * 2,
  'A#5' : 466.16 * 2,
  'Bb5' : 466.16 * 2,
  'B5'  : 493.88 * 2,
  'C6'  : 261.63 * 4,
  'C#6' : 277.18 * 4,
  'Db6' : 277.18 * 4,
  'D6'  : 293.66 * 4,
  'D#6' : 311.13 * 4,
  'Eb6' : 311.13 * 4,
  'E6'  : 329.63 * 4,
  'F6'  : 349.23 * 4,
  'F#6' : 369.99 * 4,
  'Gb6' : 369.99 * 4,
  'G6'  : 392.00 * 4,
  'G#6' : 415.30 * 4,
  'Ab6' : 415.30 * 4,
  'A6'  : 440.00 * 4,
  'A#6' : 466.16 * 4,
  'Bb6' : 466.16 * 4,
  'B6'  : 493.88 * 4,
  'C7'  : 261.63 * 8,
  'C#7' : 277.18 * 8,
  'Db7' : 277.18 * 8,
  'D7'  : 293.66 * 8,
  'D#7' : 311.13 * 8,
  'Eb7' : 311.13 * 8,
  'E7'  : 329.63 * 8,
  'F7'  : 349.23 * 8,
  'F#7' : 369.99 * 8,
  'Gb7' : 369.99 * 8,
  'G7'  : 392.00 * 8,
  'G#7' : 415.30 * 8,
  'Ab7' : 415.30 * 8,
  'A7'  : 440.00 * 8,
  'A#7' : 466.16 * 8,
  'Bb7' : 466.16 * 8,
  'B7'  : 493.88 * 8,
  'C8'  : 261.63 * 16,
  'C#8' : 277.18 * 16,
  'Db8' : 277.18 * 16,
  'D8'  : 293.66 * 16,
  'D#8' : 311.13 * 16,
  'Eb8' : 311.13 * 16,
  'E8'  : 329.63 * 16,
  'F8'  : 349.23 * 16,
  'F#8' : 369.99 * 16,
  'Gb8' : 369.99 * 16,
  'G8'  : 392.00 * 16,
  'G#8' : 415.30 * 16,
  'Ab8' : 415.30 * 16,
  'A8'  : 440.00 * 16,
  'A#8' : 466.16 * 16,
  'Bb8' : 466.16 * 16,
  'B8'  : 493.88 * 16,
  'C9'  : 261.63 * 32,
}

REST_INDICATOR = 'R'
REST = 1 # Using a very low frequency tone versus stopping() audio playback completely to reduce "clicking"

# Design Decision - to support varying the tempo on-the-fly,
# we are going to standardize on the following durations
# but then adjust the actual playback speed at runtime
DURATIONS = {
    '1' : 240 / DEFAULT_BPM,
    '2' : 120 / DEFAULT_BPM,
    '4' : 60 / DEFAULT_BPM,
    '8' : 30 / DEFAULT_BPM,
    '16' : 15 / DEFAULT_BPM,

    '1.' : 360 / DEFAULT_BPM,
    '2.' : 180 / DEFAULT_BPM,
    '4.' : 90 / DEFAULT_BPM,
    '8.' : 45 / DEFAULT_BPM,
    '16.' : 22.5 / DEFAULT_BPM,

    '4t' : 40 / DEFAULT_BPM,
    '8t' : 20 / DEFAULT_BPM,
    '16t' : 10 / DEFAULT_BPM,
}

class SongPlayer():
    """Compile and play text-based songs"""
    def __init__(self, waveform_name = "flute"):
        if hasattr(self, '__doc__'):
            return  # Autodoc stop here

        # Note that we use the soundmaker instance auto-created by soundlib
        self.tone = soundmaker.get_tone(waveform_name)
        self.track_player = TrackPlayer(self.tone)

    def set_voice(self, waveform_name):
        self.tone = soundmaker.get_tone(waveform_name)
        self.track_player.set_tone(self.tone)

    def set_bpm(self, bpm):
        self.track_player.set_bpm(bpm)

    def compile_error(self, track):
        print("Unsupported song_text format! Maybe expand your track compiler?")
        return track

    def compile_snippet(self, note_name, note_duration):
        if note_name == REST_INDICATOR:
            note_pitch = REST
        elif note_name in NOTES:
            note_pitch = NOTES[note_name]
        else:
            print("Unsupported note name! Maybe add " + note_name + " to your NOTES dictionary?")
            return None

        if note_duration in DURATIONS:
            duration = DURATIONS[note_duration]
        else:
            print("Unsupported note (or rest) duration! Maybe add " + note_duration + " to your DURATIONS dictionary?")
            return None

        return (note_pitch, duration)

    def compile_piece(self, piece):
        # The only thing that is not optional is a note name (or R for rest)
        found = False
        while not found:
            for note_name in 'ABCDEFGR':
                index = piece.find(note_name)
                if index != -1:
                    found = True
                    break
        if not found:
            return None

        if index == 0:
            # No left-hand side
            note_duration = self.default_duration
        else:
            note_duration = piece[0:index]
            self.default_duration = note_duration

        if index == len(piece)-1:
            note_name = piece[index] + self.default_octave
        else:
            partial_note_name = piece[index]
            remainder = piece[index+1:]
            
            if (remainder[0] == '#') or (remainder[0] == 'b'):
                partial_note_name += remainder[0]
                remainder = remainder[1:]

            if remainder == '':
                note_name = partial_note_name + self.default_octave
            elif remainder[0] in "123456789":
                note_name = partial_note_name + remainder[0]
                self.default_octave = remainder[0]
            else:
                temp_octave = int(self.default_octave)
                while len(remainder):
                    if remainder[0] == '+':
                        temp_octave += 1
                    elif remainder[0] == '-':
                        temp_octave -= 1
                    remainder = remainder[1:]
                if temp_octave < 1:
                    temp_octave = 1
                if temp_octave > 9:
                    temp_octave = 9
                self.default_octave = str(temp_octave)
                note_name = partial_note_name + self.default_octave

        # Rests don't have octaves
        if note_name[0] == 'R':
            note_name = 'R'

        snippet = self.compile_snippet(note_name, note_duration)
        return snippet

    def compile_song(self, song_text):
        """Convert a song from an ASCII representation to a list of frequency, duration pairs"""
        self.default_duration = '4'
        self.default_octave = '4'

        track = []

        source_list = song_text.split()
        for piece in source_list:
            snippet = self.compile_piece(piece)

            if snippet is not None:
                track.append(snippet)
            else:
                print("Unsupported song_text format! Maybe track compiler needs expanding?")
                return track

        print("song_text compiled into track format successfuly")
        return track

    def play_compiled_song(self, track):
        """Play a list of frequency, duration pairs (play a 'track')"""
        self.track_player.set_track(track)
        self.track_player.play()

    def play_song(self, song_text):
        """Play a song based on an ASCII representation (compiles it, then plays it)"""
        track = self.compile_song(song_text)
        self.play_compiled_song(track)
        return track # in case you want to play it again without recompiling it (ex. after tempo or voice changes)

# Create the global SongPlayer instance
song_player = SongPlayer()
