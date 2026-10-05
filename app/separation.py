"""Runs the phase-1-chosen models over an upload.

Imports stem-shootout's own separate.py rather than reimplementing output
canonicalization — that file's canonicalize() exists specifically because a
naive version of this logic once let Kim_Vocal_2's instrumental output
silently overwrite the real vocals file (see HANDOFF.md). Reuse, don't
re-risk that bug.

Unlike stem-shootout's own run_model() (a batch CLI with no UI to feed),
run_model_with_progress() below captures audio-separator's tqdm output
live, since the web UI needs to show what's actually happening during a
run that can take tens of minutes on CPU-only hardware.
"""
import importlib.util
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from . import config

_spec = importlib.util.spec_from_file_location(
    "stem_shootout_separate", config.STEM_SHOOTOUT_SCRIPTS / "separate.py"
)
_separate = importlib.util.module_from_spec(_spec)
sys.modules["stem_shootout_separate"] = _separate
_spec.loader.exec_module(_separate)

# Matches tqdm's default bar format, e.g. " 68%|██████▊   | 17/25 [22:21<10:34, 79.34s/it]"
_PROGRESS_RE = re.compile(r"(\d+)%\|.*?\|\s*(\d+)/(\d+)\s*\[([^\]]+)\]")


def run_model_with_progress(
    mixdown: Path, model: str, output_dir: Path, on_progress: Callable[[str], None]
) -> dict[str, str]:
    model_dir = output_dir / model
    model_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "audio-separator",
        str(mixdown),
        "-m", model,
        "--output_dir", str(model_dir),
        "--output_format", "WAV",
    ]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    last_sent = 0.0
    for line in process.stdout:
        line = line.strip()
        match = _PROGRESS_RE.search(line)
        now = time.monotonic()
        if match and now - last_sent > 1.0:
            pct, done, total, timing = match.groups()
            on_progress(f"{pct}% ({done}/{total} chunks, {timing})")
            last_sent = now
    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"audio-separator (model {model}) exited with code {process.returncode}")

    return _separate.canonicalize_outputs(model_dir)


def separate_upload(
    input_path: Path, output_dir: Path, on_progress: Callable[[str], None] = lambda s: None
) -> dict[str, Path]:
    """Runs the vocal specialist and the 4-stem model, keeping only the stems
    phase 1's evidence says each one is actually best at."""
    on_progress(f"Loading vocal model ({config.VOCAL_MODEL})…")
    vocal_manifest = run_model_with_progress(
        input_path, config.VOCAL_MODEL, output_dir,
        lambda p: on_progress(f"Vocal model ({config.VOCAL_MODEL}): {p}"),
    )

    on_progress(f"Loading instrumental model ({config.INSTRUMENTAL_MODEL})…")
    instrumental_manifest = run_model_with_progress(
        input_path, config.INSTRUMENTAL_MODEL, output_dir,
        lambda p: on_progress(f"Instrumental model ({config.INSTRUMENTAL_MODEL}): {p}"),
    )

    stems: dict[str, Path] = {}
    if "vocals" in vocal_manifest:
        stems["vocals"] = Path(vocal_manifest["vocals"])
    for name in ("drums", "bass", "other"):
        if name in instrumental_manifest:
            stems[name] = Path(instrumental_manifest[name])
    return stems
