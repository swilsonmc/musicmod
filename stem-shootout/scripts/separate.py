"""Run one or more audio-separator models over a mixdown and canonicalize their output.

Shells out to the `audio-separator` CLI rather than its Python API: the CLI
is the documented, stable surface, and model identifiers are meant to be
discovered with `audio-separator --list_models`, not guessed here.

Different model architectures name their output files differently (and some
only produce vocals/instrumental, not a full 4-stem split). This script
doesn't try to paper over that — it pattern-matches filenames into the
canonical buckets it recognizes (vocals, drums, bass, other, instrumental,
plus guitar/piano for 6-stem models like htdemucs_6s) and records exactly
what each model actually produced in manifest.json, so score.py only ever
scores stems that genuinely exist for a given model.

Before adding a new pattern here, check the model's exact output filenames
first (run it once, look at what it actually wrote) rather than guessing —
and check the new substring doesn't appear in any model's own NAME, the
same way "Kim_Vocal_2.onnx" collided with the "vocals" pattern (see the
bug writeup in HANDOFF.md / stem-shootout/README.md). "guitar" and "piano"
were checked against htdemucs_6s.yaml's own name before being added below.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

CANONICAL_PATTERNS = {
    "vocals": ["vocal"],
    "instrumental": ["instrumental"],
    "drums": ["drum"],
    "bass": ["bass"],
    "guitar": ["guitar"],
    "piano": ["piano"],
    "other": ["other"],
}


def canonicalize(filename: str) -> str | None:
    """audio-separator names output files `<input>_(<StemLabel>)_<model>.<ext>`.

    Match against just the parenthesized stem label first, not the whole
    filename — matching the whole filename is a real bug that bit us:
    `Kim_Vocal_2.onnx`'s own model name contains "vocal", so the
    instrumental output (`..._(Instrumental)_Kim_Vocal_2.wav`) also
    matched the "vocals" pattern and silently overwrote the real vocals
    file when both got renamed to the same canonical target. Falls back
    to whole-filename matching only if no parenthesized label is found,
    for models that don't follow this naming convention.
    """
    lower = filename.lower()
    labels = re.findall(r"\(([^)]+)\)", lower)
    for label in labels:
        for canonical, patterns in CANONICAL_PATTERNS.items():
            if any(p in label for p in patterns):
                return canonical
    if labels:
        return None  # had a label, just not one we recognize — don't fall through
        # to whole-filename matching, which could wrongly match the model name instead.

    for canonical, patterns in CANONICAL_PATTERNS.items():
        if any(p in lower for p in patterns):
            return canonical
    return None


def canonicalize_outputs(model_dir: Path) -> dict[str, str]:
    """Rename whatever a model produced in model_dir into canonical stem names
    and write manifest.json. Pulled out of run_model() so a test can exercise
    this exact renaming/path logic without actually invoking audio-separator —
    a hand-rolled parallel implementation here previously diverged from the
    real one and masked a path-resolution bug.
    """
    manifest: dict[str, str] = {}
    for produced in model_dir.glob("*.wav"):
        canonical = canonicalize(produced.name)
        if canonical is None:
            print(f"[separate] WARNING: couldn't classify {produced.name}, leaving as-is", file=sys.stderr)
            continue
        target = model_dir / f"{canonical}.wav"
        if canonical in manifest and produced != Path(manifest[canonical]):
            # Defense in depth: two different output files mapped to the same
            # bucket, which would otherwise silently clobber one with the
            # other (exactly how the Kim_Vocal_2 bug above went unnoticed).
            sys.exit(f"[separate] REFUSING to continue: both {manifest[canonical]!r} "
                     f"and {produced!r} canonicalized to '{canonical}' — fix "
                     f"canonicalize() for this model's naming convention first")
        if produced != target:
            shutil.move(str(produced), str(target))
        # Absolute path, deliberately: this manifest is a transient artifact
        # read back by score.py in the same run, not something meant to be
        # portable, and a relative-path convention here previously caused a
        # real path-resolution bug once two scripts disagreed on what it was
        # relative to.
        manifest[canonical] = str(target.resolve())

    manifest_path = model_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"[separate] {model_dir.name} produced: {sorted(manifest)}", file=sys.stderr)
    return manifest


def run_model(mixdown: Path, model: str, output_dir: Path) -> dict[str, str]:
    model_dir = output_dir / model
    model_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "audio-separator",
        str(mixdown),
        "-m", model,
        "--output_dir", str(model_dir),
        "--output_format", "WAV",
    ]
    print(f"[separate] running: {' '.join(cmd)}", file=sys.stderr)
    subprocess.run(cmd, check=True)

    return canonicalize_outputs(model_dir)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mixdown", required=True, type=Path, help="Official final stereo mixdown WAV")
    ap.add_argument("--models", required=True, help="Comma-separated audio-separator model identifiers")
    ap.add_argument("--output-dir", default=Path("data/estimates"), type=Path)
    args = ap.parse_args()

    if not args.mixdown.exists():
        sys.exit(f"Mixdown not found: {args.mixdown}")

    results = {}
    for model in [m.strip() for m in args.models.split(",") if m.strip()]:
        results[model] = run_model(args.mixdown, model, args.output_dir)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
