"""Drum transcription: onset detection + a spectral-shape heuristic, not a trained model.

No maintained, pip-installable drum transcription model was found that
actually works on current Python (madmom is unmaintained — it still uses
`collections.MutableSequence` and `np.float`, both removed years ago;
omnizart needs system audio headers this machine doesn't have and a
TensorFlow version with no Python 3.12 build — same wall basic_pitch hit).

This instead reuses what's already in the venv (librosa) the same way
stem-shootout/scripts/classify_tracks.py classifies raw tracks: a cheap,
explainable heuristic, documented as exactly that rather than passed off
as more accurate than it is. It finds onsets, then classifies each one by
where its energy sits in the spectrum — a kick is low-frequency, a closed
hi-hat is high-frequency and noisy, everything else defaults to snare.
Toms, open hi-hats, cymbals, and ghost notes are not distinguished.

**Not scored against ground truth.** Nothing in the stem-shootout catalog
has a separate hit-by-hit drum reference yet, so unlike every other model
choice in this project, this one hasn't been measured, only reasoned
about. Treat it as a draft until that changes (see HANDOFF.md).
"""
from pathlib import Path

import librosa
import numpy as np
import pretty_midi

SR = 22050
CLASSIFY_WINDOW_SEC = 0.05

# General MIDI percussion key map (channel 10) — the numbers a MIDI player
# actually understands as "kick"/"snare"/"hi-hat", not a tuning choice.
KICK, SNARE, CLOSED_HAT = 36, 38, 42

LOW_HZ = 150     # below this: kick
HIGH_HZ = 3000   # above this, or noisy: hi-hat
LOW_ENERGY_THRESHOLD = 0.35
HIGH_ENERGY_OR_NOISE_THRESHOLD = 0.25


def classify_onset(window: np.ndarray, sr: int) -> int:
    if len(window) < 64:
        return SNARE
    spectrum = np.abs(np.fft.rfft(window * np.hanning(len(window))))
    freqs = np.fft.rfftfreq(len(window), 1 / sr)
    total = spectrum.sum() + 1e-9
    low_fraction = spectrum[freqs < LOW_HZ].sum() / total
    high_fraction = spectrum[freqs > HIGH_HZ].sum() / total
    noisiness = float(np.mean(librosa.zero_crossings(window)))

    if low_fraction > LOW_ENERGY_THRESHOLD:
        return KICK
    if high_fraction > HIGH_ENERGY_OR_NOISE_THRESHOLD or noisiness > HIGH_ENERGY_OR_NOISE_THRESHOLD:
        return CLOSED_HAT
    return SNARE


def transcribe_drums(audio_path: Path) -> pretty_midi.PrettyMIDI:
    y, sr = librosa.load(str(audio_path), sr=SR, mono=True)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="frames", backtrack=False)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)

    window_len = int(CLASSIFY_WINDOW_SEC * sr)
    loudest = float(onset_env.max()) or 1.0
    instrument = pretty_midi.Instrument(program=0, is_drum=True, name="drums")

    for frame, t in zip(onset_frames, onset_times):
        start_sample = int(t * sr)
        pitch = classify_onset(y[start_sample : start_sample + window_len], sr)
        velocity = int(np.clip(40 + 87 * onset_env[frame] / loudest, 1, 127))
        instrument.notes.append(pretty_midi.Note(velocity=velocity, pitch=pitch, start=float(t), end=float(t) + 0.08))

    midi = pretty_midi.PrettyMIDI()
    midi.instruments.append(instrument)
    return midi
