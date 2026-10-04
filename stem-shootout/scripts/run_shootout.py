"""Orchestrate the full model shootout for one song: separate -> align -> score -> report.

Takes a path to a song's config.json (see config.example.json) — every path
inside it is relative to that config file's own directory, so each song
under data/songs/<slug>/ is self-contained. Separates the mixdown with
every configured model, aligns the real reference stems to the mixdown's
timeline, scores each model, and writes results.md/results.json next to
the config.

Usage: python run_shootout.py --config ../data/songs/discipline/config.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from score import build_reference_set, score_model
from separate import run_model


def ensure_aligned_reference(config: dict, song_dir: Path) -> Path:
    reference_raw = song_dir / config["raw_multitrack_dir"]
    reference_dir = song_dir / "reference_bucketed"
    aligned_dir = song_dir / "reference_aligned"

    if aligned_dir.exists() and any(aligned_dir.iterdir()):
        print(f"[shootout] reusing existing aligned reference at {aligned_dir}", file=sys.stderr)
        return aligned_dir

    # Local imports, only needed on first run — and run as their own CLIs
    # (via sys.argv) rather than reimplementing their logic here, so the
    # alignment sanity checks (offset plausibility, gain-staging ratio)
    # only exist in one place and can't drift out of sync between them.
    from bus_reference import main as bus_main
    sys.argv = [
        "bus_reference.py",
        "--raw-dir", str(reference_raw),
        "--mapping", str(song_dir / config["bucket_mapping"]),
        "--output-dir", str(reference_dir),
    ]
    bus_main()

    from align import main as align_main
    sys.argv = [
        "align.py",
        "--mixdown", str(song_dir / config["mixdown"]),
        "--reference-dir", str(reference_dir),
        "--output-dir", str(aligned_dir),
    ]
    align_main()

    return aligned_dir


def render_markdown(song_name: str, results: list[dict]) -> str:
    stems = ["vocals", "drums", "bass", "other", "instrumental"]
    lines = [f"# {song_name}", "",
             "| Model | " + " | ".join(f"{s} SDR" for s in stems) + " |",
             "|---" * (len(stems) + 1) + "|"]
    for r in results:
        row = [r["model"]]
        for s in stems:
            v = r["stems"].get(s, {}).get("SDR")
            row.append(f"{v:.2f}" if v is not None else "—")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    lines.append("SDR in dB, higher is better. Full SDR/ISR/SIR/SAR breakdown is in results.json.")
    for r in results:
        if r.get("note"):
            lines.append(f"- **{r['model']}**: {r['note']}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True, type=Path, help="Path to a song's config.json")
    ap.add_argument("--force", action="store_true",
                     help="Re-run separation even for models that already have a manifest.json "
                          "(by default those are reused — separation is the expensive step, "
                          "scoring is cheap and always re-runs so results reflect the current "
                          "reference alignment)")
    args = ap.parse_args()

    if not args.config.exists():
        sys.exit(f"No such config: {args.config}")
    config = json.loads(args.config.read_text())
    song_dir = args.config.parent

    aligned_dir = ensure_aligned_reference(config, song_dir)
    refs = build_reference_set(aligned_dir)

    estimates_root = song_dir / "estimates"
    results = []
    for model in config["models"]:
        manifest_path = estimates_root / model / "manifest.json"
        if not args.force and manifest_path.exists():
            print(f"[shootout] {model}: reusing existing separation output "
                  f"(pass --force to redo)", file=sys.stderr)
            manifest = json.loads(manifest_path.read_text())
        else:
            manifest = run_model(song_dir / config["mixdown"], model, estimates_root)
        result = score_model(manifest, refs)
        result["model"] = model
        results.append(result)
        print(f"[shootout] {model}: {result['stems']}", file=sys.stderr)

    (song_dir / "results.json").write_text(json.dumps(results, indent=2))
    report = render_markdown(config["song_name"], results)
    (song_dir / "results.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
