"""Smoke test for app/transcription.py on synthetic audio with known notes.

Checks wiring (time units, pitch numbering, octave, note grouping) by
driving the real transcription code — not a benchmark of accuracy on real
music, which needs real ground-truth MIDI.

Run: venv/bin/python -m tests.smoke_transcription
"""
import sys
import tempfile
from pathlib import Path

import mir_eval
import numpy as np
import soundfile as sf

from app.transcription import transcribe_stem

SR = 44100


def tone(midi_pitch: int, seconds: float) -> np.ndarray:
    """A harmonic tone with a short attack/decay — closer to an instrument than a pure sine."""
    t = np.arange(int(SR * seconds)) / SR
    f = 440.0 * 2 ** ((midi_pitch - 69) / 12)
    wave = sum(np.sin(2 * np.pi * f * k * t) / k ** 1.5 for k in range(1, 6))
    envelope = np.minimum(1, t / 0.01) * np.exp(-t * 1.5)
    return (wave * envelope).astype(np.float32)


def render(events: list[tuple[list[int], float, float]], total: float) -> np.ndarray:
    audio = np.zeros(int(SR * total), dtype=np.float32)
    for pitches, start, dur in events:
        for p in pitches:
            seg = tone(p, dur)
            i = int(start * SR)
            audio[i : i + len(seg)] += seg
    return 0.5 * audio / np.abs(audio).max()


def score(stem: str, events, total: float, min_f1: float) -> bool:
    ref_iv = np.array([[s, s + d] for ps, s, d in events for _ in ps])
    ref_hz = np.array([440.0 * 2 ** ((p - 69) / 12) for ps, _, _ in events for p in ps])
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"{stem}.wav"
        sf.write(path, render(events, total), SR)
        midi = transcribe_stem(stem, path)
    notes = [n for inst in midi.instruments for n in inst.notes]
    est_iv = np.array([[n.start, n.end] for n in notes]) if notes else np.zeros((0, 2))
    est_hz = np.array([440.0 * 2 ** ((n.pitch - 69) / 12) for n in notes])
    # Onset + pitch only: offsets of decaying tones are inherently fuzzy.
    p, r, f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ref_iv, ref_hz, est_iv, est_hz, onset_tolerance=0.05, offset_ratio=None
    )
    ok = f1 >= min_f1
    print(f"{'PASS' if ok else 'FAIL'} {stem:7s} precision={p:.2f} recall={r:.2f} F1={f1:.2f} "
          f"(need >= {min_f1}); {len(notes)} notes found, {len(ref_hz)} expected")
    return ok


def main() -> None:
    bass_line = [([p], 0.2 + i * 0.6, 0.5) for i, p in enumerate([40, 43, 45, 47, 48, 45, 43, 40])]
    melody = [([p], 0.2 + i * 0.4, 0.35) for i, p in enumerate([60, 62, 64, 65, 67, 69, 71, 72])]
    chords = [(ps, 0.2 + i * 1.0, 0.9) for i, ps in enumerate([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]])]

    results = [
        score("bass", bass_line, 5.5, 0.9),
        score("vocals", melody, 3.8, 0.9),
        score("other", chords, 4.5, 0.8),
    ]
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
