"""Score one model's separated stems against the aligned official reference stems.

Uses museval (the SDR/ISR/SIR/SAR metric from the SiSEC/MDX separation
challenges) rather than eyeballing waveforms. Crucially, SIR (how much of
one source leaks into another source's estimate) is only meaningful when
museval sees *all* the true sources together in one call — scoring stems
one at a time throws that signal away. So this script evaluates a model's
full available stem set in a single museval.evaluate() call:

  - a model with all 4 of vocals/drums/bass/other -> one 4-source evaluation
  - a model with only vocals + instrumental -> one 2-source evaluation,
    where "instrumental" reference = drums + bass + other summed
  - anything else -> scored with whatever it has (SIR won't be meaningful
    with a single source, but SDR/SAR still are) and flagged as such
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import museval
import numpy as np

from common import load_audio, match_length

FULL_4STEM = ["vocals", "drums", "bass", "other"]


def build_reference_set(reference_dir: Path) -> dict[str, np.ndarray]:
    refs = {b: load_audio(reference_dir / f"{b}.wav") for b in FULL_4STEM}
    max_len = max(r.shape[0] for r in refs.values())
    instrumental = np.zeros((max_len, 2), dtype="float32")
    for b in ("drums", "bass", "other"):
        instrumental[: refs[b].shape[0]] += refs[b]
    refs["instrumental"] = instrumental
    return refs


def score_model(manifest: dict[str, str], refs: dict[str, np.ndarray]) -> dict:
    available = [b for b in manifest if b in refs]
    if set(FULL_4STEM).issubset(available):
        stems = FULL_4STEM
    elif {"vocals", "instrumental"}.issubset(available):
        stems = ["vocals", "instrumental"]
    else:
        stems = available

    if not stems:
        return {"stems": {}, "note": "model produced no stems we could match to a reference bucket"}

    ref_arrays, est_arrays = [], []
    for stem in stems:
        est = load_audio(Path(manifest[stem]))
        ref, est = match_length(refs[stem], est)
        ref_arrays.append(ref)
        est_arrays.append(est)

    references = np.stack(ref_arrays, axis=0)
    estimates = np.stack(est_arrays, axis=0)

    sdr, isr, sir, sar = museval.evaluate(references, estimates)

    result = {"stems": {}, "note": None if len(stems) > 1 else
              "only one matchable stem — SIR is not meaningful without other true sources"}
    for i, stem in enumerate(stems):
        result["stems"][stem] = {
            "SDR": float(np.nanmedian(sdr[i])),
            "ISR": float(np.nanmedian(isr[i])),
            "SIR": float(np.nanmedian(sir[i])),
            "SAR": float(np.nanmedian(sar[i])),
        }
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--estimates-dir", required=True, type=Path,
                     help="data/estimates/<model>/ — must contain manifest.json from separate.py")
    ap.add_argument("--reference-dir", required=True, type=Path,
                     help="Aligned reference dir from align.py (contains vocals/drums/bass/other.wav)")
    ap.add_argument("--output", type=Path, default=None, help="Optional path to write JSON result")
    args = ap.parse_args()

    manifest_path = args.estimates_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"No manifest.json in {args.estimates_dir} — run separate.py first")
    manifest = json.loads(manifest_path.read_text())

    refs = build_reference_set(args.reference_dir)
    result = score_model(manifest, refs)
    result["model"] = args.estimates_dir.name

    print(json.dumps(result, indent=2))
    if args.output:
        args.output.write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
