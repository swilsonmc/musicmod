"""Best-effort auto-classification of obfuscated raw multitrack filenames into
vocals/drums/bass/other, using signal features rather than a human listening
to each file.

Some officially-released multitracks (e.g. Bon Iver's "Stems Project") give
each track a filename deliberately unrelated to its content — a place name
instead of "Lead Vocal.wav" — specifically so remixers had to listen rather
than cherry-pick. That's a real barrier to adding a song to this harness:
nobody wants to sit and listen to 10+ isolated tracks by hand every time.

This computes a few cheap, well-understood features per track and applies
simple, explainable thresholds — not a trained model, no ground truth to
train on here. It prints its reasoning for every track and writes a
*draft* reference_mapping.json for a human to sanity-check and edit, not a
final answer to trust blindly. Treat it the way you'd treat a first-pass
auto-tagger: a time-saver, not an oracle.

Usage: python classify_tracks.py <raw_dir> [--output mapping.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

ANALYSIS_SECONDS = 30.0  # a representative excerpt, not the whole track — this is for a quick
                          # classification signal, not a precise measurement, and running
                          # pyin pitch tracking over a full 5-minute track per file adds up fast


def analyze(path: Path) -> dict:
    y, sr = librosa.load(str(path), sr=22050, mono=True, duration=None)
    # Skip near-silent leading/trailing sections — pick the loudest contiguous
    # excerpt so a quiet intro doesn't dominate a short analysis window.
    rms_full = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    if rms_full.max() < 1e-6:
        return {"path": path.name, "silent": True}

    win_frames = int(ANALYSIS_SECONDS * sr / 512)
    if len(rms_full) > win_frames:
        start_frame = int(np.argmax(
            np.convolve(rms_full, np.ones(win_frames), mode="valid")
        ))
        start = start_frame * 512
    else:
        start = 0
    y = y[start: start + int(ANALYSIS_SECONDS * sr)]

    overall_rms = float(np.sqrt(np.mean(y ** 2)))

    harmonic, percussive = librosa.effects.hpss(y)
    harmonic_energy = float(np.sum(harmonic ** 2))
    percussive_energy = float(np.sum(percussive ** 2))
    percussive_ratio = percussive_energy / (harmonic_energy + percussive_energy + 1e-9)

    spec = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)
    low_band = spec[freqs < 200].sum()
    total_band = spec.sum() + 1e-9
    low_freq_fraction = float(low_band / total_band)

    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"), sr=sr
    )
    voiced_fraction = float(np.mean(voiced_flag)) if voiced_flag is not None else 0.0
    median_f0 = float(np.nanmedian(f0)) if voiced_fraction > 0 else 0.0

    return {
        "path": path.name, "silent": False, "rms": overall_rms,
        "percussive_ratio": percussive_ratio, "low_freq_fraction": low_freq_fraction,
        "zcr": zcr, "spectral_centroid": centroid,
        "voiced_fraction": voiced_fraction, "median_f0": median_f0,
    }


def classify(features: dict) -> tuple[str, str]:
    """Returns (bucket, reasoning). Thresholds are hand-picked and approximate —
    print the reasoning so a human can judge, don't just trust the label."""
    if features.get("silent"):
        return "other", "near-silent track (likely an unused/blank channel)"

    f = features
    if f["percussive_ratio"] > 0.55 and f["voiced_fraction"] < 0.15:
        return "drums", f"percussive_ratio={f['percussive_ratio']:.2f} (high), " \
                         f"voiced_fraction={f['voiced_fraction']:.2f} (low)"

    if f["low_freq_fraction"] > 0.5 and f["median_f0"] < 250 and f["percussive_ratio"] < 0.4:
        return "bass", f"low_freq_fraction={f['low_freq_fraction']:.2f} (high), " \
                        f"median_f0={f['median_f0']:.0f}Hz (low), not percussive"

    if f["voiced_fraction"] > 0.4 and 80 < f["median_f0"] < 1100:
        return "vocals", f"voiced_fraction={f['voiced_fraction']:.2f} (high), " \
                          f"median_f0={f['median_f0']:.0f}Hz (in vocal range)"

    return "other", f"didn't clearly match drums/bass/vocals — percussive_ratio=" \
                     f"{f['percussive_ratio']:.2f}, voiced_fraction={f['voiced_fraction']:.2f}, " \
                     f"low_freq_fraction={f['low_freq_fraction']:.2f}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("raw_dir", type=Path)
    ap.add_argument("--output", type=Path, default=None,
                     help="Write the draft mapping here (default: print only)")
    args = ap.parse_args()

    files = sorted(args.raw_dir.glob("*.wav"))
    if not files:
        sys.exit(f"No .wav files in {args.raw_dir}")

    mapping: dict[str, list[str]] = {"vocals": [], "drums": [], "bass": [], "other": []}
    for path in files:
        features = analyze(path)
        bucket, reasoning = classify(features)
        mapping[bucket].append(path.name)
        print(f"{path.name:30s} -> {bucket:8s} ({reasoning})", file=sys.stderr)

    print(json.dumps(mapping, indent=2))
    if args.output:
        args.output.write_text(json.dumps(mapping, indent=2) + "\n")
        print(f"\n[classify_tracks] DRAFT mapping written to {args.output} — "
              f"review it, this is a heuristic guess, not ground truth", file=sys.stderr)


if __name__ == "__main__":
    main()
