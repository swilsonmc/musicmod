"""Orchestrate the full model shootout: separate -> align -> score -> report.

Reads config.json (see config.example.json) for the song paths and the list
of audio-separator models to compare, runs each model, scores it against
the aligned official reference stems, and writes a markdown leaderboard.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from common import apply_offset, best_offset, load_audio, save_audio
from score import build_reference_set, score_model
from separate import run_model

ROOT = Path(__file__).parent.parent


def ensure_aligned_reference(config: dict) -> Path:
    reference_raw = ROOT / config["raw_multitrack_dir"]
    reference_dir = ROOT / "data" / "reference_bucketed"
    aligned_dir = ROOT / "data" / "reference_aligned"

    if aligned_dir.exists() and any(aligned_dir.iterdir()):
        print(f"[shootout] reusing existing aligned reference at {aligned_dir}", file=sys.stderr)
        return aligned_dir

    from bus_reference import main as bus_main  # local import, only needed on first run
    sys.argv = [
        "bus_reference.py",
        "--raw-dir", str(reference_raw),
        "--mapping", str(ROOT / config["bucket_mapping"]),
        "--output-dir", str(reference_dir),
    ]
    bus_main()

    mixdown = load_audio(ROOT / config["mixdown"])
    full_mix = load_audio(reference_dir / "full_mix.wav")
    offset = best_offset(reference=mixdown, target=full_mix)
    print(f"[shootout] reference/mixdown offset: {offset} samples", file=sys.stderr)

    for bucket in ("vocals", "drums", "bass", "other"):
        aligned = apply_offset(load_audio(reference_dir / f"{bucket}.wav"), offset)
        save_audio(aligned_dir / f"{bucket}.wav", aligned)

    return aligned_dir


def render_markdown(results: list[dict]) -> str:
    stems = ["vocals", "drums", "bass", "other", "instrumental"]
    lines = ["| Model | " + " | ".join(f"{s} SDR" for s in stems) + " |",
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
    config_path = ROOT / "config.json"
    if not config_path.exists():
        sys.exit("No config.json — copy config.example.json to config.json and fill it in first")
    config = json.loads(config_path.read_text())

    aligned_dir = ensure_aligned_reference(config)
    refs = build_reference_set(aligned_dir)

    estimates_root = ROOT / "data" / "estimates"
    results = []
    for model in config["models"]:
        manifest = run_model(ROOT / config["mixdown"], model, estimates_root)
        result = score_model(manifest, estimates_root / model, refs)
        result["model"] = model
        results.append(result)
        print(f"[shootout] {model}: {result['stems']}", file=sys.stderr)

    (ROOT / "data" / "results.json").write_text(json.dumps(results, indent=2))
    report = render_markdown(results)
    (ROOT / "data" / "results.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
