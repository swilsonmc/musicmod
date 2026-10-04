"""Time-align the busses reference stems to the official mixdown.

The official multitracks and the official mixdown were not necessarily
bounced with identical head/tail silence, so before scoring we need to find
the sample offset between them (via cross-correlation of the reference's
full_mix.wav against the real mixdown) and shift every reference bucket by
that same offset. Getting this wrong silently tanks every model's score
equally, which would make the shootout meaningless, so this step reports
the measured offset for a sanity check.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import apply_offset, best_offset, gain_staging_ratio, load_audio, save_audio

BUCKETS = ["vocals", "drums", "bass", "other"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mixdown", required=True, type=Path, help="Official final stereo mixdown WAV")
    ap.add_argument("--reference-dir", required=True, type=Path,
                     help="Output dir from bus_reference.py (contains full_mix.wav + bucket WAVs)")
    ap.add_argument("--output-dir", required=True, type=Path)
    args = ap.parse_args()

    mixdown = load_audio(args.mixdown)
    full_mix = load_audio(args.reference_dir / "full_mix.wav")

    offset = best_offset(reference=mixdown, target=full_mix)
    print(f"[align] measured offset: {offset} samples "
          f"({offset / 44100:.2f} s) — reference lags mixdown if positive. "
          "Large offsets are normal (extended intros/outros trimmed before release), "
          "but double check this is the right mixdown/multitrack pair.",
          file=sys.stderr)

    if abs(offset) > 44100 * 80:
        print("[align] WARNING: offset is within 10s of the 90s search window edge — "
              "the true offset may be outside that window, or this may be the wrong pair",
              file=sys.stderr)

    ratio = gain_staging_ratio(mixdown, full_mix)
    print(f"[align] full_mix/mixdown RMS ratio: {ratio:.2f} (expect roughly 0.4-2.0)",
          file=sys.stderr)
    if not (0.4 <= ratio <= 2.0):
        print("[align] WARNING: ratio is well outside the plausible range — the raw "
              "tracks probably aren't gain-staged consistently with the mixdown (seen "
              "on a real release: tracks exported 'flat' for a remix contest, not at "
              "mix-faithful levels). SDR numbers from this song's reference may not "
              "be meaningful even if alignment and scoring run without error — see "
              "common.py's gain_staging_ratio docstring.", file=sys.stderr)

    for bucket in BUCKETS:
        path = args.reference_dir / f"{bucket}.wav"
        if not path.exists():
            continue
        aligned = apply_offset(load_audio(path), offset)
        save_audio(args.output_dir / f"{bucket}.wav", aligned)

    print(f"[align] wrote aligned reference stems to {args.output_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
