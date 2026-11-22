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
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import deque
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

# bs-roformer-infer (stem-shootout's EXTERNAL_MODELS) reports progress
# differently from audio-separator: no clean percentage, just a rolling
# "Estimated time remaining" line rewritten in place with \r, no \n (source
# inspection of its utils.py's demix_track() — see HANDOFF.md's bs-roformer
# entries for why it's used at all despite this).
_BSR_REMAINING_RE = re.compile(r"Estimated time remaining:\s*([\d.]+)\s*seconds")


def run_model_with_progress(
    mixdown: Path, model: str, output_dir: Path, on_progress: Callable[[int, str], None]
) -> dict[str, str]:
    """on_progress(pct, detail) — pct is tqdm's own 0-100 reading."""
    model_dir = output_dir / model
    model_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "audio-separator",
        str(mixdown),
        "-m", model,
        "--output_dir", str(model_dir),
        "--output_format", "WAV",
        "--model_file_dir", str(config.MODELS_DIR),
    ]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    recent_lines: deque[str] = deque(maxlen=8)
    last_sent = 0.0
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        match = _PROGRESS_RE.search(line)
        if not match:
            # Everything else (model loading, warnings, tracebacks) still belongs in the server log.
            print(line, flush=True)
            recent_lines.append(line)
            continue
        now = time.monotonic()
        if now - last_sent > 1.0:
            pct, done, total, timing = match.groups()
            on_progress(int(pct), f"{done}/{total} chunks, {timing}")
            last_sent = now
    process.wait()

    if process.returncode < 0:
        raise RuntimeError(
            f"Stopped partway through the {model} model — usually because musicmod was "
            "stopped during the separation. Upload the song again to retry."
        )
    if process.returncode != 0:
        raise RuntimeError(f"{model} failed (exit code {process.returncode}). Last output: " + " | ".join(recent_lines))

    return _separate.canonicalize_outputs(model_dir)


def run_external_model_with_progress(
    mixdown: Path, model: str, output_dir: Path, on_progress: Callable[[int | None, str], None]
) -> dict[str, str]:
    """For models audio-separator doesn't ship (currently just
    bs_roformer_sw) — runs bs-roformer-infer directly instead, mirroring
    stem-shootout's run_external_model()/label_bs_roformer_outputs() so
    output naming/canonicalization stays identical between the shootout and
    this app.

    on_progress(pct, detail) — pct is always None here: unlike
    audio-separator's tqdm chunk counter, bs-roformer-infer only exposes a
    rolling "time remaining" estimate for a single-file job, not a clean
    percentage (confirmed from its source — it counts tracks, and a job
    here is always exactly one track). detail carries that ETA instead.
    """
    model_dir = output_dir / model
    model_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / mixdown.name).symlink_to(mixdown.resolve())
        cmd = [
            "bs-roformer-infer", "--model", _separate.EXTERNAL_MODELS[model],
            "--input_folder", str(tmp_path), "--store_dir", str(model_dir),
            "--device", config.BS_ROFORMER_DEVICE, "--output_format", "wav_float32",
        ]
        # Its stdout is block-buffered when piped, so PYTHONUNBUFFERED is the
        # difference between live progress and everything arriving at once
        # at the very end.
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env,
        )

        recent_lines: deque[str] = deque(maxlen=8)
        last_sent = 0.0
        # Its ETA line is rewritten in place with \r, never terminated by
        # \n — iterating process.stdout line-by-line (which only splits on
        # \n) would hold it hostage behind whatever real \n-terminated line
        # comes next. Read raw and split on both ourselves instead.
        buf = ""
        while True:
            chunk = process.stdout.read(256)
            if not chunk:
                break
            buf += chunk
            while True:
                split = re.search(r"[\r\n]", buf)
                if not split:
                    break
                line, buf = buf[:split.start()], buf[split.end():]
                line = line.strip()
                if not line:
                    continue
                match = _BSR_REMAINING_RE.search(line)
                if not match:
                    print(line, flush=True)
                    recent_lines.append(line)
                    continue
                now = time.monotonic()
                if now - last_sent > 1.0:
                    remaining_min = float(match.group(1)) / 60
                    on_progress(None, f"~{remaining_min:.1f} min remaining")
                    last_sent = now
        process.wait()

    if process.returncode < 0:
        raise RuntimeError(
            f"Stopped partway through the {model} model — usually because musicmod was "
            "stopped during the separation. Upload the song again to retry."
        )
    if process.returncode != 0:
        raise RuntimeError(f"{model} failed (exit code {process.returncode}). Last output: " + " | ".join(recent_lines))

    _separate.label_bs_roformer_outputs(model_dir, model)
    return _separate.canonicalize_outputs(model_dir)


# The whole pipeline a fresh upload goes through, including the transcription
# that automatically follows separation (see main.py's _run_separation) — a
# fixed 3 stages the progress text always counts against, even though this
# function itself only drives the first two.
TOTAL_PIPELINE_STAGES = 3


def separate_upload(
    input_path: Path, output_dir: Path,
    on_progress: Callable[[int, int, int | None, str], None] = lambda stage, total, pct, detail: None,
) -> dict[str, Path]:
    """Runs the vocal specialist and the 4-stem model, keeping only the stems
    phase 1's evidence says each one is actually best at.

    on_progress(stage, total_stages, pct, detail) — pct is None while a
    model is still loading (before tqdm has anything to report)."""
    on_progress(1, TOTAL_PIPELINE_STAGES, None, f"Loading vocal model ({config.VOCAL_MODEL})…")
    vocal_manifest = run_model_with_progress(
        input_path, config.VOCAL_MODEL, output_dir,
        lambda pct, detail: on_progress(1, TOTAL_PIPELINE_STAGES, pct, f"Vocal model ({config.VOCAL_MODEL}): {detail}"),
    )

    on_progress(2, TOTAL_PIPELINE_STAGES, None, f"Loading instrumental model ({config.INSTRUMENTAL_MODEL})…")
    # bs_roformer_sw (and any future addition to stem-shootout's
    # EXTERNAL_MODELS) isn't in audio-separator's catalog, so it runs
    # through its own CLI instead — see run_external_model_with_progress().
    run_instrumental = (
        run_external_model_with_progress if config.INSTRUMENTAL_MODEL in _separate.EXTERNAL_MODELS
        else run_model_with_progress
    )
    instrumental_manifest = run_instrumental(
        input_path, config.INSTRUMENTAL_MODEL, output_dir,
        lambda pct, detail: on_progress(2, TOTAL_PIPELINE_STAGES, pct, f"Instrumental model ({config.INSTRUMENTAL_MODEL}): {detail}"),
    )

    stems: dict[str, Path] = {}
    if "vocals" in vocal_manifest:
        stems["vocals"] = Path(vocal_manifest["vocals"])
    # guitar/piano only ever show up for a 6-stem instrumental model
    # (bs_roformer_sw, htdemucs_6s) — a 4-stem one (htdemucs.yaml) simply
    # never produces them, so this stays correct either way.
    for name in ("drums", "bass", "guitar", "piano", "other"):
        if name in instrumental_manifest:
            stems[name] = Path(instrumental_manifest[name])
    return stems
