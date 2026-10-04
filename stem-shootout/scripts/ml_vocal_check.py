"""Decide which raw multitrack files are vocals using a vocal-isolation model
itself as the judge, not a hand-rolled pitch heuristic.

classify_tracks.py's cheap signal-processing heuristic works reasonably
for drums (percussive ratio) and bass (low-frequency energy), but its
vocal detection — "has a clear, stable pitch in a human range" — can't
tell a sung vocal from any other clean melodic instrument (a guitar lead,
a horn, a lap steel). On a real test (Bon Iver's "Perth") it mislabeled
several non-vocal instrumental tracks as vocals.

A vocal isolation model was trained specifically to make that
distinction, so use one as the arbiter: run each raw track through it,
and measure what fraction of the energy it routes to the vocals output.
This is slower (~4 min/track on CPU for Kim_Vocal_2) but far more
trustworthy for exactly the call the cheap heuristic gets wrong.

Usage: python ml_vocal_check.py <raw_dir> [--output results.json] [--model Kim_Vocal_2.onnx]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

DEFAULT_MODEL = "Kim_Vocal_2.onnx"
VOCAL_FRACTION_THRESHOLD = 0.15  # even a backing/doubled vocal track routes well above this;
                                  # a genuinely non-vocal track routed ~0.003 in testing


def vocal_fraction(wav_path: Path, model: str) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["audio-separator", str(wav_path), "-m", model,
             "--output_dir", tmp, "--output_format", "WAV"],
            check=True,
        )
        vocals_file = next(Path(tmp).glob("*Vocals*.wav"))
        instrumental_file = next(Path(tmp).glob("*Instrumental*.wav"))
        v, _ = sf.read(str(vocals_file))
        i, _ = sf.read(str(instrumental_file))
        v_rms = float(np.sqrt(np.mean(v.astype("float64") ** 2)))
        i_rms = float(np.sqrt(np.mean(i.astype("float64") ** 2)))
        return v_rms / (v_rms + i_rms + 1e-12)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("raw_dir", type=Path)
    ap.add_argument("--output", type=Path, default=None)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    files = sorted(args.raw_dir.glob("*.wav"))
    if not files:
        sys.exit(f"No .wav files in {args.raw_dir}")

    results = {}
    for path in files:
        frac = vocal_fraction(path, args.model)
        is_vocal = frac > VOCAL_FRACTION_THRESHOLD
        results[path.name] = {"vocal_fraction": frac, "is_vocal": is_vocal}
        print(f"{path.name:30s} vocal_fraction={frac:.4f} -> "
              f"{'VOCAL' if is_vocal else 'not vocal'}", file=sys.stderr)

    if args.output:
        args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
