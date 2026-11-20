import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent

# Secrets live outside this (public) repo — see CLAUDE.md "Layout".
load_dotenv(Path("/var/www/projects/musicmod/.env"))

STORAGE_ROOT = Path(os.environ["STORAGE_ROOT"])
UPLOADS_DIR = STORAGE_ROOT / "uploads"
STEMS_DIR = STORAGE_ROOT / "stems"
# audio-separator's default cache is /tmp, which is wiped on reboot (1.7GB re-download each time).
MODELS_DIR = STORAGE_ROOT / "models"
MIDI_DIR = STORAGE_ROOT / "midi"
DOWNLOADS_DIR = STORAGE_ROOT / "downloads"

MYSQL_HOST = os.environ["MYSQL_HOST"]
MYSQL_DATABASE = os.environ["MYSQL_DATABASE"]
MYSQL_USER = os.environ["MYSQL_USER"]
MYSQL_PASSWORD = os.environ["MYSQL_PASSWORD"]

STEM_SHOOTOUT_SCRIPTS = REPO_ROOT / "stem-shootout" / "scripts"

# Phase 1's shootout result (see HANDOFF.md): no single model wins at
# everything, so two separate runs feed the stems a song gets.
VOCAL_MODEL = "melband_roformer_instvox_duality_v2.ckpt"
# Swapped from htdemucs.yaml (2026-11-20): the 2026-10-31/11-01 HANDOFF.md
# entries measured a real, 17-of-18-comparisons win for bs_roformer_sw over
# htdemucs_6s on this project's own ground truth, and it's also a 6-stem
# model (adds guitar/piano, which htdemucs.yaml's 4 stems never produced at
# all) — not integrated into the live app until now, only the shootout
# harness. Needs bs-roformer-infer importable from wherever this app's own
# venv runs (see HANDOFF.md/CLAUDE.md) — NOT just the separate research venv
# the shootout harness uses — and runs far slower (~76 min vs ~8 min on this
# machine's CPU per the same HANDOFF.md measurement).
INSTRUMENTAL_MODEL = "bs_roformer_sw"
