# musicmod — project notes

Loads in addition to `/var/www/CLAUDE.md` (the machine-wide file, not in this
repo) for any session working in this directory. See `HANDOFF.md` for the
project vision, architecture decisions, and phase 1 results — this file only
covers facts specific to running the project locally.

## Layout

This repo (`/var/www/musicmod`) is public on GitHub and holds **code only**.
Secrets, user uploads, generated audio/MIDI, and backups live outside it, at
`/var/www/projects/musicmod/` (not a git repo, never pushed):

```
/var/www/musicmod/            this repo — code, public
/var/www/projects/musicmod/
├── .env                      MySQL + LLM API keys, mode 0600 — see .env.example in this repo for the var names
├── control/                  start/stop request file written by the dashboard (see "Running the server")
├── storage/
│   ├── uploads/               user-submitted songs
│   ├── stems/                 separated stem output
│   ├── models/                downloaded AI model files (~1.7 GB; NOT /tmp, which reboots wipe)
│   ├── midi/                  transcribed/edited MIDI
│   ├── downloads/             yt-dlp video + ffmpeg-extracted audio per YouTube download (one UUID folder each)
│   └── logs/server.log        everything the server and audio-separator print
└── backups/                  mysqldump output — see /var/www/CLAUDE.md "Backups"
```

Load `.env` relative to that path, not relative to this repo — the two
directories are siblings only by convention (both named `musicmod`), not
nested.

## System dependencies

`ffmpeg` must be installed system-wide (`sudo apt install ffmpeg`) —
`audio-separator` shells out to it directly and fails without it on PATH.
Not pip-installable; it's a system package, not a Python one. `app/youtube.py`
also shells out to it directly, to pull the audio track out of a downloaded
video.

There's an unrelated, older `yt-dlp` at `/usr/bin/yt-dlp` (an apt package,
root-owned, version 2024.04.09) — not this project's and not touched by it.
This project's own copy lives in `musicmod/venv/`, kept current by
`ensure_ytdlp_updated()` (a real `pip install --upgrade` before every single
download, not just at install time — YouTube changes often enough that a
stale yt-dlp is the most common way this kind of tool breaks). The systemd
service's `PATH` (see "Running the server" below) already puts the venv
first, so the bare `yt-dlp` command in `app/youtube.py` resolves to the
current one in production; a manual test from an interactive shell needs
`PATH=/var/www/musicmod/venv/bin:$PATH` set first, or it'll silently hit the
old system one instead and fail confusingly (`--js-runtimes: no such option`).

YouTube increasingly requires solving a small JS "challenge" to unlock every
format; `app/youtube.py` points yt-dlp at the system's Node (`/usr/bin/node`,
already present, already on the service's `PATH` — no new dependency) via
`--js-runtimes node:...` plus `--remote-components ejs:github` (yt-dlp's own
official challenge-solver component, fetched from their GitHub releases, not
a third-party script). Without both flags, some downloads emit a `n
challenge solving failed` warning and may be missing the best-quality format.

## Python environment

Own venv at `musicmod/venv/` (gitignored, not shared with the other two
venvs on this machine — `audio-separator` pulls in PyTorch and other heavy,
version-sensitive deps that don't belong growing a shared environment).

```bash
/var/www/musicmod/venv/bin/python
```

Install/update deps with that venv's `pip` from the top-level `requirements.txt`
(which includes `stem-shootout/requirements.txt`). **Install PyTorch from the
CPU index first** (`pip install torch torchvision --index-url
https://download.pytorch.org/whl/cpu`): this laptop has only an Intel iGPU, and
a plain install pulls the CUDA build — ~5 GB of unusable NVIDIA libraries.
Then `pip install --no-deps basic-pitch==0.4.0` — its declared TensorFlow
dependency doesn't exist for Python 3.12; it runs on its bundled ONNX model.

Smoke test for transcription (synthetic audio, real code):
`venv/bin/python -m tests.smoke_transcription`.

**Don't try `madmom` or `omnizart` for drum transcription** — both dead
ends on this machine (unmaintained APIs removed from Python/numpy years
ago, and a TensorFlow version with no Python 3.12 build, respectively).
Full story in HANDOFF.md's Phase 3 addendum. Drums use a from-scratch
onset+spectral heuristic (`app/drum_transcription.py`) instead.

## Database

MySQL database `musicmod_dev`, scoped user `musicmod_app` (not root — see
`/var/www/CLAUDE.md` MySQL section for why). Credentials are in `.env`
(`MYSQL_HOST`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD`).

MySQL 8.0.46 here rejects `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` as a
syntax error; `app/db.py` adds later columns by catching "duplicate column"
(errno 1060) instead. Follow that pattern for new columns.

## Running the server

FastAPI on `http://127.0.0.1:8000`, run by a **systemd user service**
(`musicmod.service`, runs as swilsonmc, no root) — not Apache, no PHP.
Unit files live in `deploy/`; `deploy/install-user-services.sh` copies them to
`~/.config/systemd/user/`. **Re-run that script after editing anything in
`deploy/`** — the installed copies don't update themselves.

- It never starts at boot or login (no `[Install]` section) — the user wants
  to start it by hand. Start/stop from the `/var/www` dashboard
  (`http://localhost/`, musicmod card), or `systemctl --user start|stop musicmod`.
- The dashboard runs as www-data and can't manage a user service, so it writes
  `start`/`stop` to `projects/musicmod/control/request`; `musicmod-control.path`
  (enabled, starts at login, costs nothing) sees the write and runs
  `deploy/musicmod-control.sh`, which calls systemctl.
- User services stop when swilsonmc logs out (linger is off) — that kills any
  running separation. The next startup marks such jobs as interrupted.
- **After changing app code: `systemctl --user restart musicmod`.** Don't also
  launch uvicorn by hand from a session — it would fight the service for port 8000.
- Restarting kills any separation in progress. Check `/api/uploads` for
  `processing` jobs first; a real song can take over an hour.
- Logs: `projects/musicmod/storage/logs/server.log` (append-only).
