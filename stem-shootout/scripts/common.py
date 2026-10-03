"""Shared audio I/O helpers for the stem-separation model shootout.

Every script in this folder works on plain (nsampl, nchan) float32 arrays at
a single shared sample rate, so this module is the only place that touches
file formats or does resampling/alignment bookkeeping.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import correlate

TARGET_SR = 44100


def load_audio(path: Path, target_sr: int = TARGET_SR) -> np.ndarray:
    """Load a file as float32 (nsampl, 2). Mono files are duplicated to stereo."""
    data, sr = sf.read(str(path), always_2d=True, dtype="float32")
    if sr != target_sr:
        raise ValueError(
            f"{path} is {sr} Hz, expected {target_sr} Hz. "
            "Resample the source files before running the shootout — "
            "don't resample inside the scoring step, it should compare "
            "exactly what each model actually produced."
        )
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    return data


def save_audio(path: Path, data: np.ndarray, sr: int = TARGET_SR) -> None:
    """Write float32 WAV losslessly.

    soundfile's default WAV subtype is PCM_16, which hard-clips anything
    outside [-1, 1] — exactly what happens when independent stems are
    summed without a mix engineer's gain staging. Every intermediate file
    in this pipeline (reference buckets, aligned stems, estimates) must
    survive values outside that range untouched, so always write FLOAT.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), data, sr, subtype="FLOAT")


def match_length(*arrays: np.ndarray) -> list[np.ndarray]:
    """Trim every array to the shortest one's length so they line up sample-for-sample."""
    n = min(a.shape[0] for a in arrays)
    return [a[:n] for a in arrays]


def best_offset(reference: np.ndarray, target: np.ndarray, max_lag_seconds: float = 90.0,
                 sr: int = TARGET_SR) -> int:
    """Find the sample offset that best aligns `target` to `reference` via cross-correlation.

    Positive return value means `target` lags `reference` (trim that many
    samples off the front of `target`, or pad the front of `reference`).
    Uses mono-summed signals — alignment only needs timing, not timbre.

    Uses a direct FFT cross-correlation rather than a decimate-then-refine
    search: naively decimating by slicing (no anti-alias filtering) can
    land exactly on the zero-crossings of the transients — drum hits,
    consonants — that alignment actually depends on, silently producing a
    wildly wrong offset. FFT correlation over a full song is still fast
    enough (seconds, not minutes) that the coarse stage isn't needed.

    Default max_lag is 90s, not a couple of seconds: real multitrack
    sessions routinely run a lot longer than the released edit (NIN's
    "Discipline" multitrack is ~50s longer than the album cut — an
    extended intro/outro trimmed before release) and a too-tight search
    window will silently find the wrong peak instead of the true one.
    """
    ref_mono = reference.mean(axis=1)
    tgt_mono = target.mean(axis=1)
    max_lag = int(max_lag_seconds * sr)

    corr = correlate(tgt_mono, ref_mono, mode="full", method="fft")
    zero_lag_index = len(ref_mono) - 1
    lo = max(0, zero_lag_index - max_lag)
    hi = min(len(corr) - 1, zero_lag_index + max_lag)
    best_index = lo + int(np.argmax(corr[lo: hi + 1]))
    return best_index - zero_lag_index


def peak_normalize(data: np.ndarray, target_peak: float = 0.98) -> np.ndarray:
    """Scale so the loudest sample hits target_peak.

    Used when building a synthetic mixdown by summing independently
    released stems: without a mix engineer's gain staging, that sum
    routinely exceeds 0dBFS (e.g. +2.5dB on one real test case), which
    isn't representative of a real mastered mix even once clipping itself
    is fixed elsewhere.
    """
    peak = float(np.abs(data).max())
    if peak == 0:
        return data
    return data * (target_peak / peak)


def apply_offset(target: np.ndarray, offset: int) -> np.ndarray:
    """Shift `target` by `offset` samples (as returned by best_offset) relative to a reference."""
    if offset > 0:
        return target[offset:]
    if offset < 0:
        pad = np.zeros((-offset, target.shape[1]), dtype=target.dtype)
        return np.concatenate([pad, target], axis=0)
    return target
