"""Sum raw official multitrack files into whatever stem buckets the mapping defines.

The official multitracks are per-instrument (Kick, Snare, Bass DI, Lead Vox,
Gtr 1, ...), not already split the way an AI model splits them. To get a fair
ground truth for comparing against a model's output, we need to bus them
down ourselves: sum every track assigned to "drums" into one drums.wav,
every track assigned to "vocals" into one vocals.wav, and so on.

The bucket mapping is a plain JSON file you fill in once you can see the
actual track list for the chosen song. The usual 4-bucket case:

    {
      "vocals": ["Lead Vox.wav", "Harmony Vox.wav"],
      "drums":  ["Kick In.wav", "Kick Out.wav", "Snare Top.wav", "OH L.wav", "OH R.wav"],
      "bass":   ["Bass DI.wav", "Bass Amp.wav"],
      "other":  ["Gtr 1.wav", "Gtr 2.wav", "Synth.wav", "Keys.wav"]
    }

But any bucket names work — e.g. a song with separate guitar and piano
tracks can use a 6-bucket mapping (vocals/drums/bass/guitar/piano/other)
to test a 6-stem model like htdemucs_6s, as long as score.py and the
model being tested agree on the names. Keys starting with "_" (like
"_method", documenting how the mapping was built) are metadata, not
buckets, and are skipped.

Also writes full_mix.wav (the sum of every bucket), which align.py uses
to find the sample offset against the official mixdown.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from common import save_audio, load_audio


def sum_bucket(raw_dir: Path, filenames: list[str]) -> np.ndarray:
    tracks = [load_audio(raw_dir / fn) for fn in filenames]
    max_len = max(t.shape[0] for t in tracks)
    total = np.zeros((max_len, 2), dtype="float32")
    for t in tracks:
        total[: t.shape[0]] += t
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw-dir", required=True, type=Path, help="Directory holding the raw multitrack WAVs")
    ap.add_argument("--mapping", required=True, type=Path, help="JSON bucket mapping, see module docstring")
    ap.add_argument("--output-dir", required=True, type=Path)
    args = ap.parse_args()

    mapping = json.loads(args.mapping.read_text())
    bucket_names = [k for k in mapping if not k.startswith("_")]
    if not bucket_names:
        sys.exit("Mapping has no buckets (every key starts with '_', i.e. is metadata)")

    buckets = {}
    for bucket in bucket_names:
        filenames = mapping[bucket]
        print(f"[bus] {bucket}: summing {len(filenames)} track(s)", file=sys.stderr)
        buckets[bucket] = sum_bucket(args.raw_dir, filenames)
        save_audio(args.output_dir / f"{bucket}.wav", buckets[bucket])

    max_len = max(b.shape[0] for b in buckets.values())
    full_mix = np.zeros((max_len, 2), dtype="float32")
    for b in buckets.values():
        full_mix[: b.shape[0]] += b
    save_audio(args.output_dir / "full_mix.wav", full_mix)
    print(f"[bus] wrote {len(buckets)} buckets + full_mix.wav to {args.output_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
