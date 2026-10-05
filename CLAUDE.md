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
├── storage/
│   ├── uploads/               user-submitted songs
│   ├── stems/                 separated stem output
│   ├── midi/                  transcribed/edited MIDI
│   └── logs/
└── backups/                  mysqldump output — see /var/www/CLAUDE.md "Backups"
```

Load `.env` relative to that path, not relative to this repo — the two
directories are siblings only by convention (both named `musicmod`), not
nested.

## Python environment

Own venv at `musicmod/venv/` (gitignored, not shared with the other two
venvs on this machine — `audio-separator` pulls in PyTorch and other heavy,
version-sensitive deps that don't belong growing a shared environment).

```bash
/var/www/musicmod/venv/bin/python
```

Install/update deps with that venv's `pip`, from `stem-shootout/requirements.txt`
for now; a top-level `requirements.txt` will replace it once phase 2's FastAPI
backend exists.

## Database

MySQL database `musicmod_dev`, scoped user `musicmod_app` (not root — see
`/var/www/CLAUDE.md` MySQL section for why). Credentials are in `.env`
(`MYSQL_HOST`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD`).

## Web tier

None yet. Phase 2's FastAPI backend will serve itself on its own port
(e.g. `uvicorn` on `127.0.0.1:8000`) rather than running under Apache —
there's no PHP in this project, and the architecture in `HANDOFF.md`
assumes a lightweight backend it controls directly. Revisit this file if
that changes (e.g. an Apache reverse-proxy gets added for LAN access).
