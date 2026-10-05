"""Runs the phase-1-chosen models over an upload.

Imports stem-shootout's own separate.py rather than reimplementing output
canonicalization — that file's canonicalize() exists specifically because a
naive version of this logic once let Kim_Vocal_2's instrumental output
silently overwrite the real vocals file (see HANDOFF.md). Reuse, don't
re-risk that bug.
"""
import importlib.util
import sys
from pathlib import Path

from . import config

_spec = importlib.util.spec_from_file_location(
    "stem_shootout_separate", config.STEM_SHOOTOUT_SCRIPTS / "separate.py"
)
_separate = importlib.util.module_from_spec(_spec)
sys.modules["stem_shootout_separate"] = _separate
_spec.loader.exec_module(_separate)


def separate_upload(input_path: Path, output_dir: Path) -> dict[str, Path]:
    """Runs the vocal specialist and the 4-stem model, keeping only the stems
    phase 1's evidence says each one is actually best at."""
    vocal_manifest = _separate.run_model(input_path, config.VOCAL_MODEL, output_dir)
    instrumental_manifest = _separate.run_model(input_path, config.INSTRUMENTAL_MODEL, output_dir)

    stems: dict[str, Path] = {}
    if "vocals" in vocal_manifest:
        stems["vocals"] = Path(vocal_manifest["vocals"])
    for name in ("drums", "bass", "other"):
        if name in instrumental_manifest:
            stems[name] = Path(instrumental_manifest[name])
    return stems
