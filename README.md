# musicmod

A locally-hosted web app for taking apart and rebuilding a song: AI stem
separation, editable MIDI transcription per stem, swapping instruments or
vocals, and a non-linear-editor-style multitrack timeline — built to run
on your own machine, not a cloud service.

**Status: Phase 3 of 6 in progress.** You can upload a song, have it
separated into vocals / drums / bass / other, play the stems back together
with per-stem mute, solo, and volume, and see each pitched stem transcribed
into notes (MIDI) on a piano roll under its waveform — playable through a
simple synth for comparison, and downloadable as a standard MIDI file.
Phase 1 — choosing which AI separation models to build on, scored against
real official multitrack recordings instead of guesswork — is done, and
its harness is still here. Note *editing*, instrument swapping, the
timeline editor, and export (rest of phase 3 through 6) don't exist yet.

## The idea

1. Upload a song; separate it into stems (vocals/drums/bass/other) with AI.
2. Transcribe each stem into an editable MIDI piano roll.
3. Edit notes freely, and re-render any stem through a different
   instrument — including replacing vocals with an instrument, or a
   different vocal performance.
4. A timeline editor in the style of non-linear video editing: mute/solo/
   volume per stem, cut/copy/paste, ripple delete, time-shift,
   time-stretch, reverse — across one or many stems — plus freely
   layering in new tracks.
5. Export stems/MIDI/a project format, playable WAV, and standard
   interchange formats (MusicXML, standard MIDI).

The full design — architecture decisions, build order, and the reasoning
behind each one — lives in [`HANDOFF.md`](./HANDOFF.md).

## Phase 2: the app (`app/`)

A small FastAPI web app, served on `http://127.0.0.1:8000` (this machine
only — nothing is exposed to the network):

- **Upload** a WAV, FLAC, MP3, OGG, or M4A file.
- **Separation runs two models, not one**, because Phase 1 showed no
  single model is best at everything: a Mel-Band Roformer vocal specialist
  (`melband_roformer_instvox_duality_v2.ckpt`) produces the vocals stem,
  and Demucs v4 (`htdemucs.yaml`) produces drums, bass, and other.
- **Live progress** while it works — which model is running, percent
  done, chunk count, and an elapsed clock — because on a CPU this is slow
  (see timings below). Jobs run one at a time; extras wait in a queue.
- **A multitrack player**: a waveform per stem, mute / solo / volume on
  each, play and stop all together.
- **An archive page** listing every separation ever attempted, with file
  size, start and finish times, and how long it took.

### How long separation takes without a GPU

Measured on the development laptop — an Intel Core i3-6100U (2 cores,
2015-era), 11 GB RAM, no graphics card usable for AI:

| Song | Length | Separation time | Ratio |
|---|---|---|---|
| Morrissey — "Mr Shankley" | 2:21 | 39 min 31 s | ~17× |
| 10,000 Maniacs — "Noah's Dove" | 4:34 | 81 min 7 s | ~18× |

So budget roughly **17–18 minutes per minute of music** on similar
hardware. About 85% of that is the Roformer vocal model; Demucs is much
faster. A machine with a supported NVIDIA GPU would be dramatically
faster, but nothing here requires one.

### Running it yourself

Built and tested on Linux (Ubuntu 24.04 family), Python 3.12, MySQL 8.0.
Paths assume the layout described in [`CLAUDE.md`](./CLAUDE.md) (code in
`/var/www/musicmod`, secrets and storage in `/var/www/projects/musicmod`);
change them in `app/config.py` and `deploy/` if yours differ.

1. **System package:** `sudo apt install ffmpeg` — the separation library
   calls it directly and fails without it.
2. **Python environment, CPU edition of PyTorch first.** Installing the
   requirements directly pulls the *GPU* (CUDA) build of PyTorch, about
   5 GB of graphics-card libraries that do nothing on a machine without an
   NVIDIA GPU. Installing the CPU build first prevents that:
   ```bash
   python3 -m venv venv
   venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
   venv/bin/pip install -r requirements.txt
   venv/bin/pip install --no-deps basic-pitch==0.4.0
   ```
   The last line is deliberate: Basic Pitch's package metadata demands a
   TensorFlow version that was never built for Python 3.12, but it also
   ships its model in ONNX format, which runs on the `onnxruntime` already
   installed for separation. `--no-deps` skips the impossible requirement;
   `requirements.txt` supplies the dependencies it actually uses.
3. **Database:** create a MySQL database and a user that can only touch
   it, then copy `.env.example` to `/var/www/projects/musicmod/.env`
   (outside the repo) and fill it in. Tables are created automatically
   on first start.
4. **Service:** `deploy/install-user-services.sh` installs a systemd
   *user* service (runs as you, no root needed). It deliberately does
   **not** start at boot; start and stop it with
   `systemctl --user start musicmod` / `stop musicmod`, or from a
   dashboard button (see `CLAUDE.md`). Server output goes to
   `/var/www/projects/musicmod/storage/logs/server.log`.

The first separation downloads about 1.7 GB of model files, cached in
`storage/models/` for every run after.

## Phase 3 (in progress): transcription to MIDI, and editing it

After separation finishes, every stem — including drums now — is
converted into notes automatically (or on demand with a **Transcribe**
button):

| Stem | Method | Why |
|---|---|---|
| other | [Basic Pitch](https://github.com/spotify/basic-pitch) (Spotify) | handles many simultaneous notes — chords, piano, strummed guitar |
| vocals, bass | pYIN pitch tracking (librosa) | follows one melody line; fewer stray notes on single-voice parts |
| drums | onset detection + a spectral-shape heuristic | kick/snare/hi-hat by where each hit's energy sits in the spectrum — **not a trained model, and not yet measured against ground truth; see HANDOFF.md** |

It's cheap: about a minute for a 4½-minute song, versus 81 minutes to
separate it. Each transcribed stem gets a piano-roll strip aligned under
its waveform, a **Synth** toggle that plays the detected notes alongside
the real audio (the quickest way to judge how good the transcription
is — drums get real-sounding synthesized kick/snare/hi-hat hits, not
pitched beeps), and a **MIDI ↓** download. Notes are in real time, not
snapped to a beat grid — tempo detection comes with notation export later.

**The piano roll is editable.** Click empty space to add a note (an
instant preview sound plays so you can hear what you just did, even with
nothing playing), drag to move or resize, Ctrl+drag to select several
notes at once, Delete/Backspace to remove the selection, Ctrl+Z to undo.
Each roll has its own zoom (🔍+/🔍−) for precise editing. Edits live in a
local buffer — **Save** and **Revert** (to the left of each roll) commit
them or throw them away; the caption always says which state you're in.

**Playback is sample-accurate across stems**, driven by a single shared
`AudioContext` clock (`app/static/audioengine.js`) rather than four
independent `<audio>` elements, which is what four-stems-started-together
used to drift apart from each other over time. Play all / Pause all /
Stop all, a combined timecode, a seek bar aligned pixel-for-pixel with
the waveforms beneath it, and a live timecode per stem — which now always
agree, by construction, since every stem reads the same clock rather than
reporting its own position.

`tests/smoke_transcription.py` checks the transcription wiring on
synthetic audio with known notes: `venv/bin/python -m
tests.smoke_transcription`. Real-music accuracy isn't measured yet for
any of the three methods — that needs songs with real ground-truth MIDI.

## Phase 1: the stem-separation model shootout

Before building any of the above, [`stem-shootout/`](./stem-shootout/)
answers a narrower question: **which AI separation model is actually most
accurate?**, measured against real ground truth rather than ear-balling
it. Several artists have released both the official mixdown *and* the
real multitrack stems for individual songs — a rare chance to score an
AI model's separated output against the true original stems with
[`museval`](https://github.com/sigsep/sigsep-mus-eval) (the SDR/ISR/SIR/SAR
metric from the SiSEC/MDX separation challenges), instead of just
listening and guessing.

The test catalog (see [`stem-shootout/README.md`](./stem-shootout/README.md)
for the full writeup of each, and [`LEADERBOARD.md`](./stem-shootout/LEADERBOARD.md)
for the cross-song results):

- **Nine Inch Nails — "Discipline"** (*The Slip*, CC-licensed) — real
  official mixdown *and* real official multitrack stems, including 2
  separate vocal harmony layers.
- **Radiohead — "Nude"** (*In Rainbows*) — 5 official remix-contest stems,
  solo falsetto vocal.
- **Linkin Park & Steve Aoki — "A Light That Never Comes"** — 8 official
  stems with separate lead and backing vocal tracks, the clearest
  vocal-harmony test case in the set.
- **Bon Iver — "Perth"** — official stems from the 2012 "Stems Project,"
  pulled out of a ~2GB full-album zip without downloading the rest. Kept
  in the catalog for variety and the tooling it drove, but excluded from
  the leaderboard averages — its raw tracks turned out not to be
  gain-staged consistently with the mixdown, a real finding documented
  in detail in `stem-shootout/README.md`.

Results so far aren't a one-model answer: the best model for isolating
vocals is not the best model for everything-but-vocals, and for the full
4-stem split, Demucs's cheaper base model currently beats its own
fine-tuned variant on 2 of 3 stems. See `stem-shootout/README.md`'s
"What this actually tells us" for the full picture, including a real bug
that was found and fixed mid-shootout.

Test audio is downloaded locally and never committed to this repo (see
`.gitignore`) — some of it is ordinary copyrighted commercial material
whose *stems* happen to have been officially released for remixing, which
doesn't make it redistributable. Only the harness code and each song's
small `config.json`/`reference_mapping.json` are tracked in git.

## What's next: more than four stems?

"Other" is a catch-all: on "Noah's Dove," piano and guitar both land in
it together. The open research question — written up in detail in
`HANDOFF.md` — is how far past four stems separation can realistically
go: piano and guitar apart, lead vocal apart from backing harmonies, and
(the stretch goal) something like Queen's "Bohemian Rhapsody" split into
as many layers as the technology allows.

## Repo layout

```
HANDOFF.md               full project vision, architecture decisions, status, next tasks
CLAUDE.md                local-machine setup notes (read automatically by Claude Code)
CONTRIBUTING.md          how to add a new song to the shootout, and general workflow
LICENSE                  MIT, for the code in this repo — not for any third-party test audio
requirements.txt         Python dependencies for the app (includes the shootout's)
app/                     FastAPI backend (separation, transcription) + static HTML/JS player and archive
tests/                   smoke tests that drive the real app code on synthetic audio
deploy/                  systemd user units + the script that installs them
stem-shootout/           Phase 1: the model-accuracy validation harness
  LEADERBOARD.md          auto-generated cross-song model comparison (see CONTRIBUTING.md)
  scripts/                 separation runner, reference alignment, museval scoring,
                            plus utilities for adding new songs (see CONTRIBUTING.md)
  data/songs/<slug>/      per-song config + real audio (gitignored) + results
```

## Ground rules

- **Private, personal use.** This isn't built to publish or distribute
  separated stems of copyrighted songs, or any AI-voice-cloned vocals.
- **Everything is free/open-source software run on your own hardware** —
  no required paid services. See `HANDOFF.md` for the specific tools and
  why each was chosen.

## Contributing

Adding a song to the shootout, or picking up development locally? See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`HANDOFF.md`](./HANDOFF.md)
respectively — both are written for whoever (human or AI agent) picks
this up next, not just the original author.
