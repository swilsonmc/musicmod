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

MYSQL_HOST = os.environ["MYSQL_HOST"]
MYSQL_DATABASE = os.environ["MYSQL_DATABASE"]
MYSQL_USER = os.environ["MYSQL_USER"]
MYSQL_PASSWORD = os.environ["MYSQL_PASSWORD"]

STEM_SHOOTOUT_SCRIPTS = REPO_ROOT / "stem-shootout" / "scripts"

# Phase 1's shootout result (see HANDOFF.md): no single model wins at
# everything, so two separate runs feed the four stems a song gets.
VOCAL_MODEL = "melband_roformer_instvox_duality_v2.ckpt"
INSTRUMENTAL_MODEL = "htdemucs.yaml"
