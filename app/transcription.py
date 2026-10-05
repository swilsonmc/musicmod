"""Audio -> MIDI for each separated stem (Phase 3).

Method per stem follows HANDOFF.md's architecture: Basic Pitch for
polyphonic material ("other"), pYIN single-line pitch tracking for vocals
and bass. Drums aren't pitched, so neither method fits them; a dedicated
drum transcriber is a separate, not-yet-built step.

Note times are real seconds, not snapped to a beat grid — tempo and beat
detection come later, when notation export needs them.
"""
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import pretty_midi
from scipy.signal import medfilt

METHOD_BY_STEM = {"vocals": "pyin", "bass": "pyin", "other": "basic_pitch"}

# Search range for the single-line tracker; narrower is faster and avoids octave errors.
PYIN_RANGES = {"bass": ("E1", "G4"), "vocals": ("C2", "C6")}

# General MIDI programs, so a downloaded .mid sounds roughly right in other software.
GM_PROGRAM = {"vocals": 53, "bass": 33, "other": 0}  # Voice Oohs, Electric Bass (finger), Acoustic Grand Piano

PYIN_SR = 22050
PYIN_HOP = 256
MIN_NOTE_SECONDS = 0.08


def transcribe_basic_pitch(audio_path: Path) -> pretty_midi.PrettyMIDI:
    # Imported here: basic_pitch logs backend warnings on import, and only this path needs it.
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    _, midi, _ = predict(str(audio_path), ICASSP_2022_MODEL_PATH)
    return midi


def transcribe_pyin(audio_path: Path, lowest: str, highest: str) -> pretty_midi.PrettyMIDI:
    y, sr = librosa.load(str(audio_path), sr=PYIN_SR, mono=True)
    f0, voiced, _ = librosa.pyin(
        y, fmin=librosa.note_to_hz(lowest), fmax=librosa.note_to_hz(highest),
        sr=sr, frame_length=2048, hop_length=PYIN_HOP,
    )
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=PYIN_HOP)[0][: len(f0)]

    pitch = np.full(len(f0), -1)
    pitch[voiced] = np.round(librosa.hz_to_midi(f0[voiced])).astype(int)
    # Vibrato that crosses a semitone boundary would otherwise shatter one sung note into many.
    pitch = medfilt(pitch, kernel_size=5).astype(int)

    frame_seconds = PYIN_HOP / sr
    loudest = float(rms.max()) or 1.0
    instrument = pretty_midi.Instrument(program=0)

    start = 0
    for i in range(1, len(pitch) + 1):
        if i < len(pitch) and pitch[i] == pitch[start]:
            continue
        p = pitch[start]
        duration = (i - start) * frame_seconds
        if p >= 0 and duration >= MIN_NOTE_SECONDS:
            velocity = int(np.clip(30 + 90 * rms[start:i].mean() / loudest, 1, 127))
            instrument.notes.append(pretty_midi.Note(
                velocity=velocity, pitch=int(p), start=start * frame_seconds, end=i * frame_seconds,
            ))
        start = i

    midi = pretty_midi.PrettyMIDI()
    midi.instruments.append(instrument)
    return midi


def transcribe_stem(stem_name: str, audio_path: Path) -> pretty_midi.PrettyMIDI:
    method = METHOD_BY_STEM[stem_name]
    if method == "basic_pitch":
        midi = transcribe_basic_pitch(audio_path)
    else:
        midi = transcribe_pyin(audio_path, *PYIN_RANGES[stem_name])
    for instrument in midi.instruments:
        instrument.program = GM_PROGRAM[stem_name]
        instrument.name = stem_name
    return midi


def transcribe_stems(
    stems: dict[str, Path], out_dir: Path, on_progress: Callable[[str], None] = lambda s: None
) -> dict[str, tuple[Path, str, int]]:
    """Returns {stem_name: (midi_path, method, note_count)} for every stem that has a method."""
    out_dir.mkdir(parents=True, exist_ok=True)
    todo = [s for s in stems if s in METHOD_BY_STEM]
    results = {}
    for n, stem_name in enumerate(todo, 1):
        method = METHOD_BY_STEM[stem_name]
        on_progress(f"Transcribing {stem_name} ({n} of {len(todo)}, {method.replace('_', ' ')})…")
        midi = transcribe_stem(stem_name, stems[stem_name])
        path = out_dir / f"{stem_name}.mid"
        midi.write(str(path))
        results[stem_name] = (path, method, sum(len(i.notes) for i in midi.instruments))
    return results


def notes_json(midi_path: Path) -> list[list[float]]:
    """[[pitch, start_seconds, end_seconds, velocity], ...] for the piano-roll view."""
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    return [
        [n.pitch, round(n.start, 4), round(n.end, 4), n.velocity]
        for inst in midi.instruments for n in inst.notes
    ]
