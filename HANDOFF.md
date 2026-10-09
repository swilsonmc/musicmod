> **Where things stand (2026-10-05):** development moved to the owner's
> local machine on 2026-10-04 and Phase 2's first slice is working there —
> see "Phase 2 status" and "Next research task" near the end of this file.
> **Two sessions now push to this branch** (the local machine and a cloud
> session): `git pull` before starting work, and push what you finish so
> the other side can see it. The local-setup steps immediately below are
> historical; `CLAUDE.md` describes the current local setup.

# musicmod — project handoff

This file is meant to be the first message in a **new local Claude Code
session**, opened on this same repo/branch (`claude/festive-euler-4x5thj`)
on your Linux Mint machine. It captures the full project vision, the
decisions already made, what's built, and exactly what's blocked and why,
so you don't have to re-explain any of this from scratch.

Started in a cloud Claude Code session (to use a $100 Anthropic credit tied
to connecting a GitHub repo); moving to local from here on because the
later phases need `/var/www`, your actual MySQL/PHP stack, persistent
storage, and testing on your real (low-performance) hardware — none of
which the cloud container has.

## Setting up the local session, step by step

One clarification first: **Claude Code's dedicated desktop GUI only ships
for Mac and Windows** — there isn't a Linux build of that specific app.
On Linux, the real equivalent (same product, same capabilities, just a
terminal instead of a window) is the `claude` CLI. If you specifically
want the Claude *Desktop* app (the general chat app, which does run on
Linux) involved too, that's possible via a linking feature covered in
step 5 below — but the CLI is what actually does the work either way.

### 1. Install the Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

(Needs Node.js installed first — `sudo apt install nodejs npm` on Mint if
you don't have it. If this exact package name has changed by the time
you read this, check docs.claude.com/claude-code for the current install
command rather than assuming this one still works.)

### 2. Clone the repo into `/var/www`

`/var/www` is usually owned by `root`/`www-data`, so a plain `git clone`
there as your normal user will likely fail on permissions:

```bash
sudo mkdir -p /var/www/musicmod
sudo chown "$USER":"$USER" /var/www/musicmod
git clone https://github.com/swilsonmc/musicmod.git /var/www/musicmod
cd /var/www/musicmod
git checkout claude/festive-euler-4x5thj
```

(Adjust the branch name if later work has moved to a new one — check
`git branch -a` after cloning, or look at the repo on GitHub, if this
exact name is stale by the time you read it.)

### 3. Set up git push credentials, so local commits actually reach GitHub

The user explicitly wants this local session's code and commits to keep
landing on GitHub, the same way this cloud session's did — that needs
git to be authenticated locally, which a fresh clone isn't by default.
Simplest path, using the GitHub CLI:

```bash
sudo apt install gh    # or see cli.github.com for other install methods
gh auth login          # interactive — follow the browser login flow
gh auth setup-git      # wires that login into git's credential helper
```

Verify it worked with a harmless no-op push, e.g. `git push` right after
a commit with no changes should just say "Everything up-to-date" rather
than prompting for a username/password it then rejects.

### 4. Start the session in that directory

```bash
cd /var/www/musicmod
claude
```

Then, as your first message, tell it to read this file:

> Read HANDOFF.md and continue from where it leaves off.

That gives it the full project context — vision, decisions made, current
phase status — without you having to re-explain any of it.

### 5. (Optional) Drive it from the Claude Desktop app instead of a terminal

If you'd rather watch/drive this from the Claude Desktop app's window
instead of a bare terminal: install the Desktop app (Linux build from
claude.ai/download, if one's available at the time — check), then from a
terminal **in `/var/www/musicmod`** run:

```bash
claude remote-control
```

That links this local folder's session into the Desktop app's Code
interface, so you get the GUI experience while the actual work still
happens against your real local filesystem and git repo, not a cloud
container.

### 6. Keep committing and pushing as you go

Nothing automatic pushes code for you — that's a deliberate safety
behavior, not a gap. Ask the local session to commit and push after
meaningful chunks of work (it already knows to do this from this repo's
own conventions, visible in its git history), or do it yourself with
plain `git add`/`commit`/`push`. If `git status` ever wants to stage an
audio file, stop — check `.gitignore` before committing, audio should
never land in this repo.

## The vision

A locally-hosted web app that:

1. Takes an uploaded song (FLAC/WAV/etc) and separates it into stems
   (vocals/drums/bass/other) using AI.
2. Generates editable MIDI/piano-roll (not publication sheet music — see
   "sheet music" caveat below) for each stem.
3. Lets you edit notes freely, and re-render any stem through a different
   instrument (including swapping out vocals for an instrument).
4. Supports adding/replacing vocal performances, including AI-voice-cloned
   ones — **low priority, and planned as accepting an externally-sourced
   vocal track rather than generating one in-system.**
5. Gives a non-linear-editor-style timeline: mute/solo/volume per stem,
   cut/copy/paste, ripple delete, time-shift, time-stretch, reverse —
   across one or multiple stems/tracks, plus freely layering in new
   tracks.
6. Exports stems/MIDI/a project format for WAV, MusicXML, standard MIDI,
   and (informally) for re-import on another machine running the same
   system. Exporting directly to Ableton/Logic/GarageBand project files
   is **not realistic** (closed, undocumented formats) — not attempting
   that.

## Ground rules established so far

- **Private, personal, non-distributed experimentation.** Not planning to
  publish separated stems of copyrighted commercial songs, or distribute
  any AI-voice-cloned vocals (e.g. a Freddie-Mercury-style voice model).
  Both are fine to build and use privately; neither should leave this
  machine.
- **AI-generated vocals are a low-priority, separate module.** The system
  should support *importing* a vocal performance from an outside source
  as a replacement stem. Don't build vocal synthesis/cloning as a
  near-term feature.
- **Target machine is a low-performance laptop, CPU-only (no GPU
  confirmed).** Every architecture choice below assumes CPU inference and
  a lightweight frontend — don't introduce anything that assumes a GPU is
  available.
- **Model accuracy is measured, not eyeballed.** Separated stems get
  scored against real ground-truth stems with `museval` (SDR/ISR/SIR/SAR),
  the same metric used in the SiSEC/MDX separation challenges.

## Costs (answered, revisit if scope changes)

Everything scoped so far is free/open-source and runs on your own
hardware: Demucs, `audio-separator` + its model zoo (mostly MIT/Apache —
spot-check individual checkpoint licenses before anything beyond personal
use), Basic Pitch, `museval`, `pedalboard`, `pyrubberband`, FluidSynth,
free SoundFonts, WaveSurfer.js/peaks.js, the Signal piano-roll editor.
Optional future costs, none required for the current plan: a GPU
(local or rented) if CPU inference feels too slow, premium sample
libraries/VSTs for nicer instrument timbres, hosting if this ever gets
exposed beyond your LAN. Non-monetary risk, not a cash cost: keep
copyrighted source material and any voice-cloned output private, per the
ground rules above.

## Architecture decisions

- **Separation**: `python-audio-separator` (wraps Demucs, MDX-Net,
  VR-arch, BS-Roformer/Mel-Band-Roformer under one interface) — not
  Spleeter/Open-Unmix (outclassed), not hand-integrating each model
  separately.
- **Transcription (audio → MIDI)**: Spotify's **Basic Pitch** for general
  polyphonic content ("other" stem); dedicated pitch tracking (CREPE/pYIN)
  for monophonic bass/vocal melody; a dedicated drum transcriber for
  drums. Treat output as an editable piano roll, not sheet music —
  polyphonic AMT is still genuinely imperfect; notation rendering *from*
  MIDI (via `music21` → MusicXML, displayed with
  VexFlow/OpenSheetMusicDisplay) is the easy, solved part, bolted on top.
- **Instrument re-rendering**: FluidSynth + free SoundFonts (or `sfizz`
  for SFZ libraries) to re-render edited MIDI through a different
  instrument.
- **Audio manipulation engine**: `pedalboard` (effects/gain) +
  `pyrubberband` (pitch-preserving time-stretch; reverse is a trivial
  array flip). **Not** Ardour/Mixxx/SuperCollider/Pure Data as the engine
  — they're not designed to be puppeted by a web frontend; building the
  timeline/region model ourselves is the right call (it's standard,
  well-understood NLE logic: non-destructive regions referencing offsets
  into source files).
- **Frontend**: WaveSurfer.js or BBC's peaks.js for waveform+regions, a
  custom multitrack timeline (Konva/PixiJS), and the existing open-source
  **Signal** web piano-roll (`github.com/ryohey/signal`) for MIDI editing
  rather than building one from scratch. Keep it lightweight — target
  hardware is a low-performance laptop.
- **Backend**: FastAPI + Celery/RQ + Redis for the heavy separation/
  transcription jobs (these take real CPU time without a GPU — expect
  minutes per song, which is fine for a batch job, not for an interactive
  wait). MySQL (already available in `/var/www`) for project/track/region
  metadata; stems/MIDI as files on disk.

## Build order (each phase stands alone)

1. **Model shootout** (this repo's `stem-shootout/` — in progress, see
   below).
2. Upload → stems → simple multitrack player (mute/solo/volume only).
3. AMT pass + piano-roll view/edit on top of stems.
4. Instrument reassignment via MIDI re-synthesis.
5. Full NLE timeline (cut/copy/ripple-delete/time-shift/reverse).
6. Voice import/conversion module — last, lowest priority, opt-in.

## Current state: Phase 1 (stem-shootout) — DONE, decision made

Location: `stem-shootout/` in this repo. **The harness is built, 4 real
songs are staged, and the full shootout has run end to end across 4
models.** Full writeup and the cross-song leaderboard are in
`stem-shootout/README.md` and `stem-shootout/LEADERBOARD.md` — read the
README's "What this actually tells us" in full before building on this,
since the short version below necessarily loses nuance that mattered:

- **No single model wins at everything.** The best vocal isolator
  (Roformer, 5.28dB avg SDR) and the best instrumental isolator
  (Kim_Vocal_2, 10.69dB avg) are *different models* — Kim_Vocal_2 is
  worst of the 4 at pure vocals (2.96dB avg) despite being best at
  everything-but-vocals. A model's quality on one output doesn't predict
  the other.
- **For vocal isolation/replacement**: use the Roformer
  (`melband_roformer_instvox_duality_v2.ckpt`), not Demucs's bundled
  vocals output or Kim_Vocal_2.
- **For instrumental-only needs** (e.g. a karaoke-style backing track):
  Kim_Vocal_2 (`Kim_Vocal_2.onnx`), not Roformer.
- **For the full 4-stem split** (needed for per-instrument editing):
  Demucs is the only architecture tested that does this at all, and
  **the cheaper base `htdemucs.yaml` beats the fine-tuned `htdemucs_ft`
  on 2 of 3 stems on average** (drums, other) — `htdemucs_ft`'s ~4x
  runtime cost isn't earning its keep on this evidence unless vocals is
  what you need most from it.
- **Bass and "other" are the weak link everywhere Demucs was tested**,
  and real mastered commercial mixes (Discipline) are harder than
  synthetic ones across every model — plan phase 3+'s instrument-
  reassignment UI around that reality (e.g. don't promise clean
  guitar/synth re-rendering without caveats).
- **This conclusion already overturned an earlier one once** (the first
  3-song pass said "always prefer a dedicated vocal model" — a 4th
  model's data complicated that). Treat it as the current best evidence,
  not a settled fact; re-run `aggregate_results.py` after adding more
  songs or models and expect it might shift again.

This phase's engineering produced reusable infrastructure, not just one
result — worth knowing about going into later phases:

What exists:
- `scripts/common.py` — shared audio I/O, FFT-based cross-correlation
  alignment (90s default search window — real multitrack sessions run
  longer than the released edit), float32 WAV I/O (never the default
  16-bit PCM, which silently clips summed stems that exceed 0dBFS), and
  `gain_staging_ratio` — a sanity check that a song's raw multitrack
  files are actually gain-staged consistently with its mixdown (see the
  Perth story below for why this exists).
- `scripts/separate.py` — runs any `audio-separator` model over a
  mixdown, canonicalizes its output filenames into {vocals, drums, bass,
  other, instrumental} **by matching the parenthesized stem label
  specifically, not the whole filename** (see the Kim_Vocal_2 bug
  below), records what each model actually produced in an absolute-path
  `manifest.json`, and hard-fails if two outputs ever collide on one
  bucket instead of silently overwriting.
- `scripts/bus_reference.py` — sums per-instrument multitrack files into
  the 4 canonical buckets, per a JSON mapping (hand-written for clearly-
  labeled releases, auto-drafted for obfuscated ones — see below).
- `scripts/align.py` — cross-correlates the bussed reference against the
  official mixdown, reports the measured offset AND the gain-staging
  ratio, applies the offset to each reference bucket. `run_shootout.py`
  calls this (and `bus_reference.py`) as real subprocesses rather than
  reimplementing their logic, specifically so a sanity check added here
  can't be silently bypassed elsewhere.
- `scripts/score.py` — `museval` SDR/ISR/SIR/SAR scoring; evaluates all
  of a model's available stems together in one call (SIR needs every
  true source present at once, not one at a time), handles both 4-stem
  and 2-stem (vocals+instrumental) models.
- `scripts/run_shootout.py` — takes `--config <song>/config.json`, runs
  that one song end to end, writes `results.md`/`results.json` next to
  its config. Skips already-separated models by default (`--force` to
  redo), so adding one new model doesn't re-pay for the expensive ones.
- `scripts/aggregate_results.py` — rebuilds `LEADERBOARD.md` from every
  song's `results.json`, automatically excluding any song whose
  gain-staging ratio is implausible rather than silently averaging in
  numbers that aren't comparable.
- `scripts/zip_range_extract.py` — pulls specific files out of a huge
  remote ZIP via HTTP range requests, without downloading the rest (used
  to get one Bon Iver song out of a ~2GB full-album zip for ~87% less
  bandwidth).
- `scripts/classify_tracks.py` + `scripts/ml_vocal_check.py` — for songs
  with deliberately obfuscated track names. The cheap heuristic
  (percussive ratio, low-frequency energy) works for drums/bass but
  **cannot reliably tell vocals apart from other melodic instruments**
  (confirmed on real data — mislabeled 7 of 10 real tracks);
  `ml_vocal_check.py` fixes that specific gap using an actual
  vocal-isolation model as the judge instead of a pitch heuristic.
- `scripts/smoke_test.py` — synthetic end-to-end test of the whole
  pipeline (no real audio needed), including regression tests for both
  real bugs below. **Passing.**

**Four real bugs/issues were caught and fixed while building/testing
this** — not a complete list of risks eliminated, but a demonstrated
pattern of "test against real data, not just synthetic," worth
continuing in later phases:
1. An early decimate-then-refine alignment approach could silently
   discard the exact transients alignment depends on and lock onto the
   wrong peak — replaced with direct FFT correlation.
2. `separate.py` and `score.py` disagreed about what a manifest path was
   relative to, which the smoke test's own hand-rolled manifest masked —
   fixed with absolute paths; the smoke test now drives the real
   `separate.py`/`align.py` code instead of reimplementing their logic,
   specifically because this class of bug hides when a test uses a
   parallel implementation instead of the real one.
3. `save_audio` defaulted to 16-bit PCM, silently clipping synthetic
   mixdowns that exceeded 0dBFS when built by summing stems without a
   mix engineer's gain staging.
4. **`canonicalize()` matched a bucket pattern against the whole output
   filename, not just the stem label** — `Kim_Vocal_2.onnx`'s own model
   name contains "vocal", so its *instrumental* output also matched the
   "vocals" pattern and silently overwrote the real vocals file. The
   first run's numbers looked completely plausible and would have been
   reported as real findings; this was caught by checking the manifest,
   not by anything looking obviously wrong. Fixed by matching only the
   parenthesized stem label audio-separator actually uses, with a hard
   failure (not a silent overwrite) if two outputs ever collide again.

**A fifth issue, not a bug**: Bon Iver's Perth stems produced plausible
SDR numbers for every model that turned out to be meaningless — the raw
tracks weren't exported at mix-faithful gain levels (bass alone summed
to 195% of the mixdown's RMS). Nothing in the scoring pipeline could
have errored on this; it needed the dedicated `gain_staging_ratio`
check, which now runs automatically on every song.

### The song catalog — real audio already downloaded, not committed to git

`stem-shootout/data/songs/<slug>/` (gitignored — audio never goes in git,
only the small `config.json`/`reference_mapping.json` per song do, which
**are** committed):

- **`discipline`** — Nine Inch Nails, "Discipline" (*The Slip*). CC
  BY-NC-SA. Both the official mixdown (`mixdown.flac`) and the official
  multitrack stems (`reference_raw/*.flac`) are the real files — no
  synthetic mixdown needed. 14 raw tracks incl. 3 vocal layers (Lead, BV,
  Woo Voc) — bucketed in `reference_mapping.json`. The one song in the
  catalog with a genuine independently-mastered commercial mixdown, and
  the hardest for every model (negative vocals SDR across the board).
- **`nude`** — Radiohead, "Nude" (*In Rainbows*). 5 cleanly-labeled
  official stems from a 2008 remix contest (archive.org item
  [`nudestems`](https://archive.org/details/nudestems)), already public.
  Single falsetto lead, no harmony layer.
  **Not CC** — `mixdown.wav` here is a peak-normalized sum of the official
  stems (same methodology MUSDB18 itself uses for its mixtures), not an
  independently-sourced master. Easiest song in the catalog.
- **`a_light_that_never_comes`** — Linkin Park & Steve Aoki. 8
  cleanly-labeled official stems (archive.org item
  [`linkin-park-a-light-that-never-comes-remix-stems`](https://archive.org/details/linkin-park-a-light-that-never-comes-remix-stems)) including
  **separate Lead_Vocals + BG_Vocals** — the clearest harmony-vocal case
  in the set. Same non-CC/synthetic-mixdown caveat as `nude`.
- **`perth`** — Bon Iver. Official stems from the 2012 "Stems Project"
  (archive.org item [`bon-iver-bon-iver-full-album-stems`](https://archive.org/details/bon-iver-bon-iver-full-album-stems), a ~2GB
  full-album zip — only this song's files were fetched, via
  `zip_range_extract.py`). Track filenames are deliberately obfuscated
  place names; the vocals/drums/bass/other split was built automatically
  (`ml_vocal_check.py` + `classify_tracks.py`), not by listening — only 2
  of 10 tracks turned out to be vocal, a real finding against the
  album's reputation for dense vocal layering. **Excluded from
  `LEADERBOARD.md`'s averages** — see the gain-staging issue above.

A strong further candidate, found but not pursued: Radiohead's
"Reckoner" (6 official stems including separate lead+backing vocals,
same 2008 remix program as "Nude") — not mirrored under an obvious name
on archive.org the way "Nude" is; would need more digging to locate.
Other searches that came up empty as of this writing (metal band stems,
hip-hop acapella+instrumental pairs, EDM remix-contest stems) are listed
in `CONTRIBUTING.md` so they don't get re-searched from scratch. Female
lead vocalist and rap/spoken-word vocals are still gaps in the catalog.

### Next steps — phase 2

Phase 1's job (pick a model with evidence, not a guess) is done. Next:

1. Build the upload → stems → simple multitrack player (mute/solo/volume
   only, no editing yet — see "Build order" above).
2. Run separation with **two** models per upload, per the phase 1
   decision: the Roformer vocal specialist (`melband_roformer_instvox_duality_v2.ckpt`)
   for the vocals stem, Demucs `htdemucs.yaml` (the base model, not
   `htdemucs_ft`) for drums/bass/other. Don't just pick Demucs's bundled
   vocals output for the sake of simplicity — phase 1 measured a real,
   sometimes large, accuracy cost to that shortcut. If there's ever a
   mode that only needs an instrumental/backing track (no vocals at all),
   use Kim_Vocal_2 for that specifically — it beat Roformer on
   instrumental quality even though it's worse at isolating vocals.
3. `htdemucs_ft` is **not** currently worth its ~4x runtime over
   `htdemucs` by this evidence — it only won on average for vocals
   (which Roformer is already handling), and lost to the base model on
   drums and "other." Don't reach for it as a default; it's a legitimate
   option to offer as a slower "try harder" toggle, not the baseline.
4. Keep an eye on bass/"other" quality in real use — phase 1 showed these
   are the weakest, most song-dependent stems, and real mastered
   commercial mixes (not synthetic sums) are harder across every model
   tested. If that bites in practice, it's worth evaluating a dedicated
   bass-isolation model (not done here) rather than assuming Demucs'
   bundled bass/other is good enough everywhere.
5. This recommendation already changed once as more songs were added
   (see "Current state" above) — it's the best evidence so far, not a
   permanent conclusion. If phase 2 surfaces real-world cases that don't
   match it, that's a legitimate reason to add more songs to the
   shootout and re-check, not to quietly override it on a hunch.

## Phase 2 status — first slice working (2026-10-05)

Steps 1–3 of "Next steps — phase 2" above are done and running on the
target laptop: upload → two-model separation (Roformer for vocals, base
`htdemucs.yaml` for drums/bass/other) → multitrack player with
mute/solo/volume. Also built: live progress (model, percent, chunks,
elapsed time), start/finish times and file size per upload, an archive
page of every attempt, and a systemd user service started and stopped by
hand from a dashboard button. Code: `app/` (backend + static frontend),
`deploy/` (service units). Running it: `README.md` and `CLAUDE.md`.

Deliberate departures from the architecture above:

- **No Celery/RQ + Redis yet.** FastAPI's built-in background tasks plus
  an in-process lock that runs one separation at a time. One user, one
  CPU-bound job at a time — a queue service would add infrastructure
  without changing anything. Revisit if jobs need to survive a server
  restart (today a restart cancels the running job, and startup marks it
  interrupted) or run on a different machine.
- **Frontend is plain HTML/JS** with WaveSurfer.js v7 from a CDN, one
  instance per stem. No build step.

### Measured speed on the target laptop (Intel i3-6100U, 2 cores, no usable GPU)

| Song | Length | Separation time | Ratio |
|---|---|---|---|
| Morrissey — "Mr Shankley" | 2:21 | 39 min 31 s (Roformer 33:30, Demucs 6:01) | ~17× |
| 10,000 Maniacs — "Noah's Dove" | 4:34 | 81 min 7 s | ~18× |

Roughly 17–18 minutes per minute of music, ~85% of it the Roformer.

### Problems found by running it for real (all fixed — listed so nobody re-hits them)

1. **PyTorch's GPU build installs by default** even via
   `audio-separator[cpu]`: 6.1 GB venv with ~5 GB of CUDA libraries that
   can't run on an Intel iGPU. Install torch from the CPU index first
   (1.7 GB venv).
2. **`audioread` is needed but not declared** by audio-separator's
   dependency chain; it's in `requirements.txt` now.
3. **`ffmpeg` is a system package** audio-separator shells out to; pip
   can't provide it.
4. **`separate.py` runs the bare `audio-separator` command**, so whatever
   launches the server must put the venv's `bin/` first on `PATH` — the
   systemd unit does.
5. **The model cache defaulted to `/tmp`**, which reboots wipe — a silent
   1.7 GB re-download on the first separation after every restart. Now
   `storage/models/` via `--model_file_dir`.
6. **Capturing progress swallowed everything else audio-separator
   printed**, including its error messages, so a failure would have shown
   only an exit code. Non-progress output now goes to the server log, and
   the last lines are attached to the upload's error.
7. **MySQL 8.0.46 rejects `ADD COLUMN IF NOT EXISTS`** — see `app/db.py`
   for the pattern used instead.

## Next research task: split "other" further (assigned to the cloud session)

### What prompted it

Listening to the "Noah's Dove" output, the owner found piano and guitar
both inside "other" and wants each as its own stem. The stretch goal is
Queen's "Bohemian Rhapsody" separated into as many stems as possible —
its stacked vocal harmonies and many instrument layers. The owner asked
for this to be researched before anything is built into the app.

### What's available today

From `audio-separator --list_models` (version 0.47.0, checked
2026-10-05; the model list grows, so re-check):

- **`htdemucs_6s.yaml`** — Demucs v4 with six stems: vocals, drums, bass,
  **guitar, piano**, other. The only model in that list that splits
  guitar and piano. Demucs's own README cautions that its piano source
  "is not working great" — measure before trusting it.
- **Lead-vs-backing vocal models**, meant to run on an already-isolated
  vocal stem: `mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt`,
  `mel_band_roformer_karaoke_gabox.ckpt` / `_v2`,
  `mel_band_roformer_karaoke_becruily.ckpt`,
  `bs_roformer_karaoke_frazer_becruily.ckpt`,
  `bs_roformer_karaoke_anvuew.ckpt`, `UVR_MDXNET_KARA.onnx` / `_2`,
  `5_HP-Karaoke-UVR.pth`, `6_HP-Karaoke-UVR.pth`; plus backing-vocal
  extractors `UVR-BVE-4B_SN-44100-1.pth` / `-2`.
- **Narrow specialists**: `17_HP-Wind_Inst-UVR.pth` (woodwinds), crowd
  noise models. Nothing in the list targets strings, synths, organ, or
  individual drum pieces — look beyond audio-separator if that matters.

Two traps: "karaoke" in this community usually means "keep the lead,
drop the backing vocals," and which output file is which varies by
model — check each one's actual output labels. And `canonicalize()`'s
bucket patterns don't know `lead`/`backing`/`guitar`/`piano` yet; extend
them carefully (bug #4 in Phase 1 was a model *name* colliding with a
bucket word).

### How to measure it

Keep Phase 1's rule — measured against ground truth, not judged by ear.
The shootout scores four buckets today; scoring guitar, piano, lead, or
backing needs songs whose raw multitrack has those as separate tracks.

- `discipline` has 14 raw tracks, including three vocal layers (Lead,
  BV, Woo Voc) — usable for lead vs backing. Check whether its guitars
  and keys are separate tracks.
- `a_light_that_never_comes` has separate `Lead_Vocals` and `BG_Vocals`.
- `nude` has 5 stems — check what they are.
- Gap: no song in the catalog yet with clearly separate piano and guitar
  stems. Finding one is part of the task (see `CONTRIBUTING.md` for
  searches already tried).

Likely work: 6-bucket (and lead/backing) mappings alongside the existing
4-bucket ones, `score.py` and `aggregate_results.py` taught about the
extra buckets, and a leaderboard per new split.

### Realistic limits — set expectations before building

- **Piano vs guitar:** plausible. Separation models work by telling
  sounds apart by timbre, and those two differ a lot.
- **Lead vs backing vocals:** plausible to a useful degree; models are
  trained for exactly this.
- **Each individual voice in a stacked harmony:** not realistic with
  current models when the voices sound alike. In "Bohemian Rhapsody"'s
  operatic section, Freddie Mercury, Brian May, and Roger Taylor each
  multitracked their own voices many times, and those layers were
  combined on tape long before the final mix. Separation has little to
  work with when the parts share a voice, a microphone, and a room, and
  move together in close harmony. The same applies to Brian May's
  layered guitar harmonies.
- Two cheap experiments that could recover *some* of that:
  1. **Stereo position.** Layers in that section are panned to different
     places left-to-right; pan-based extraction can pull apart parts the
     AI models can't.
  2. **Phase 3's transcription.** Polyphonic pitch transcription of a
     backing-vocal stem can return each harmony *line* as separate MIDI
     notes, which Phase 4 can re-render one voice per line — separate
     parts in the MIDI domain even where the audio can't be unmixed.

### Cost on the target hardware

Each extra model pass adds time at the rates above. A 6-minute song is
about 100 minutes with today's two models; adding a 6-stem pass on the
instrumental and a lead/backing pass on the vocals could reach 3–4 hours
per song. Make any richer pipeline an opt-in choice per upload ("more
stems, much slower"), not the default.

### Where it plugs into the app

`app/separation.py`'s `separate_upload()` picks the models and maps
their outputs to stems; model names are in `app/config.py`. The `stems`
table stores a free-text stem name and the player draws whatever stems
an upload has, so more stems need no schema or player changes.

### Addendum 2026-10-06 — fine-tuning, with cloud GPU credits available

The owner has remaining cloud-session credits and is willing to spend
them on this research specifically (not just more `--list_models`
browsing). That makes an actual fine-tuning attempt worth scoping, not
just picking an off-the-shelf model.

**Use MoisesDB, not hand-built training data.** It's a real, licensed
dataset built for exactly this: stems across roughly 11 categories
(vocals, bass, drums, **guitar, piano/keys, strings, wind, other**,
plus vocal sub-types), from [Moises.ai](https://moisesai.github.io/moisesdb/).
That's a much better foundation than trying to bootstrap training data
from scratch — check its license terms for what this project's use
(private, personal, non-distributed — see "Ground rules" above) permits,
and its size against available storage before downloading.

Audio-separator is inference-only — it runs existing checkpoints, it
doesn't train them. Fine-tuning Demucs (the `htdemucs_6s` 6-stem variant
is the natural starting point, since it already separates guitar and
piano) means using [the Demucs training code](https://github.com/facebookresearch/demucs)
directly, on a GPU, which is exactly what cloud credits buy that this
laptop can't. Scope a fine-tune (continuing from the existing
`htdemucs_6s` checkpoint on a MoisesDB subset), not training from zero —
far cheaper, and the goal is extending a working model, not replacing it.
Report back: what it cost, how long it took, and — same rule as
everywhere else in this project — **scored against real held-out stems**,
not judged by ear, before anyone trusts it over the current models.

### Addendum 2026-10-06 — a concrete failure case, and the owner's question about learning from it

Running the app on Rush's "Jacob's Ladder" (*Power Windows*), the owner
noticed the vocals stem carries audible bleed during instrumental
sections with no singing — a synthesizer in a high register, probably
mistaken for Geddy Lee's high vocal range. The question: can the system
be taught from corrections like "no vocals should exist from timecode
X to Y here — that content belongs in 'other'"?

Short answer: **not by editing one song's output** — that's real signal
worth capturing, but it's not training data by itself, and the right use
of it is different from what "teach the model" first suggests:

- **A single hand-corrected clip can't fine-tune anything safely.** A
  few seconds of one song is a tiny, unrepresentative sample; fine-tuning
  a deep model on that risks overfitting to one song's quirks and
  degrading everything else it does well (catastrophic forgetting), for
  no measurable gain this project could actually verify.
- **What the correction actually is: a labeled hard-case report.** That's
  genuinely valuable — it's the same kind of real finding the phase 1
  shootout already runs on (e.g. the Kim_Vocal_2 filename-collision bug,
  the Perth gain-staging issue). The useful next step isn't training on
  it, it's **collecting many of these** as a structured log (song,
  timecode range, stem, what's wrong) rather than acting on each one in
  isolation. A few corrections scored against one song prove nothing; a
  few dozen across many songs start to show a *pattern* (e.g. "this model
  confuses high synth leads with falsetto vocals specifically in prog
  rock/synth-heavy mixes") — that's a finding worth testing a different
  model against, the same evidence-based way phase 1 picked models in the
  first place.
- **High synth vs. falsetto vocals is a known, general hard case for
  these models**, not a bug specific to this project — most public
  separation models are trained on datasets like MUSDB18, which skews
  toward certain genres/mixes, so other genres' specific instrument
  choices (prog-rock synth leads, for instance) are underrepresented. If
  the MoisesDB fine-tune above happens, specifically check whether it
  improves this exact confusion before and after — "Jacob's Ladder"'s
  flagged time range is a ready-made before/after test case.
- **What's cheap and useful right now, independent of any training
  question**: a "mark this region as wrong" feature in the app itself —
  record (upload, stem, start, end, what's wrong) when the owner notices
  bleed like this during normal listening. That's low effort, immediately
  useful (could auto-mute/duck the flagged region in-app as a quick fix
  for that one song), and builds exactly the structured log the point
  above describes, for free, as a side effect of normal use. Not built
  yet — a real candidate for a future local-session task, separate from
  this cloud research task.

If a real multitrack release of "Jacob's Ladder" or another Rush song
ever surfaces publicly (same archive.org search method as
`CONTRIBUTING.md` describes), it would upgrade this from "one flagged
clip" to an actual scored catalog entry — worth a quick search, low
priority next to the fine-tuning work above.

## Cloud research task: results (2026-10-06)

Measured, not judged by ear, per Phase 1's rule. Short version:
**don't build either split into the app as currently available** — the
real numbers don't support it yet. Harness code was generalized first
(bus_reference.py/align.py/score.py/aggregate_results.py now discover
whatever buckets a song's mapping defines, instead of assuming exactly
4) so this kind of experiment doesn't need one-off hacks — that's a
permanent, reusable change, not just scaffolding for this task.

### Guitar/piano split (`htdemucs_6s.yaml`)

`a_light_that_never_comes` already had separate `Ac__Guitar`,
`El__Guitar`, and `Piano` raw tracks (previously folded into "other") —
exactly the gap flagged above, and it turned out to already be in the
catalog. Added a `a_light_that_never_comes_6stem` entry that re-buckets
those same tracks (guitar = both guitar tracks combined, since the
model only outputs one combined guitar stem) and scored `htdemucs_6s`
against them:

| stem | SDR | note |
|---|---|---|
| guitar | **-6.13dB** | SIR -33dB — the estimate is dominated by leaked content, not guitar |
| piano | **0.01dB** | effectively silent relative to the reference |
| other | -9.10dB | down from +0.63/+1.33 in the 4-stem version of this song — once guitar/piano are pulled out, the small Effects-only reference that's left doesn't match the model's leftover output either |
| vocals | 5.90dB | drums | 11.93dB | bass | 0.01dB | all roughly consistent with the 4-stem result |

Confirms Demucs's own README caveat about piano "not working great," and
extends it to guitar being poor too, on this song at least. Full numbers
in `data/songs/a_light_that_never_comes_6stem/results.json`.

### Lead/backing vocal split (karaoke models)

Two traps from the "what's available today" section above turned out to
be real, not just theoretical:

- `mel_band_roformer_karaoke_becruily.ckpt` (Roformer architecture) is
  genuinely, not just apparently, impractical on this CPU-only
  container: confirmed ~162 inference steps at ~24-25 seconds *each*
  (not stalled — steady, consistent per-step timing), for an estimated
  total around 66 minutes to process one ~5-minute vocal clip. That's
  roughly 15-20x slower per minute of audio than every other model
  tested in this whole project (Demucs variants: ~2s/it; MDX-Net
  Kim_Vocal_2/UVR_MDXNET_KARA_2: finish in a few minutes total). Killed
  by the background time limit at 30 minutes twice before this was
  measured precisely. Not a bug or a hang — this specific checkpoint is
  simply that much heavier. Don't default to Roformer-architecture
  karaoke checkpoints without a GPU; the MDX-Net ones are the practical
  choice on CPU-only hardware like the target laptop.
- `UVR_MDXNET_KARA_2.onnx` (MDX-Net, same speed class as `Kim_Vocal_2`)
  worked and finished quickly. But its output labels are the generic
  `(Vocals)`/`(Instrumental)` — **not** `(Lead)`/`(Backing)` — confirming
  the "karaoke usually means keep-lead-drop-backing" trap: these models
  are trained to cleanly *remove* backing vocals from the kept output,
  not to cleanly *preserve* them in the discarded one. There's no reason
  to expect the discarded signal to be a good backing-vocal stem, and it
  measured accordingly:

| song | lead SDR | backing SDR |
|---|---|---|
| A Light That Never Comes (real Lead_Vocals/BG_Vocals ground truth) | 3.69dB | **-12.00dB** |
| Discipline (real Lead vs. BV+Woo Voc ground truth, offset-corrected) | -5.93dB | **-13.41dB** |

Lead recovery is modest at best (and actually worse than not splitting
at all — this same song's plain vocals SDR was 11.60dB with the
Roformer, 7.66dB with Kim_Vocal_2; splitting lead from backing loses a
lot). Backing recovery fails outright both times. Discipline being worse
than A Light That Never Comes on both metrics tracks with Phase 1's
finding that Discipline's *first-stage* vocal extraction is already the
hardest case in the catalog — chaining a second split on top of an
already-poor extraction compounds the error, as expected.

This was scored by a one-off script, not through the generalized
harness — the same literal `(Vocals)`/`(Instrumental)` labels mean
something different here (lead vs. backing) than when the same model
runs on a full mixdown (vocals vs. everything), so forcing it through
`canonicalize()` would have mislabeled it. If lead/backing splitting
becomes worth pursuing later (e.g. a GPU and a fine-tuned model change
this conclusion), it probably deserves its own small script in
`stem-shootout/scripts/` rather than bending the mixdown-shaped harness
around it.

### Bohemian Rhapsody / stacked-harmony limits

Not re-tested — the "realistic limits" section above already reasons
through why this won't work with current separation models (shared
voice/mic/room, moving in close harmony — nothing for timbre-based
separation to grab onto), and the guitar/piano and lead/backing results
just measured are consistent with that reasoning holding up: even
*easier* splits than "each voice in a stacked harmony" are struggling.
Spending real compute confirming an already-well-reasoned "this won't
work" wasn't worth it this round. The two cheap experiments it suggests
(stereo-position panning extraction, transcription-based harmony-line
separation) remain untried and still look like the more promising paths
if this gets revisited.

### Fine-tuning scoping — blocked on both GPU and dataset access, not attempted

**This cloud session has no GPU** (`nvidia-smi` not found, 4 CPU cores
only), and this product's documented environment settings don't expose
a GPU option the way the network-access toggle used earlier in this
project did — checked before concluding this, not assumed. Whatever
"cloud GPU credits" the owner has in mind, this specific session's
compute isn't them. Actual fine-tuning needs either a different kind of
cloud compute (a rented GPU instance — AWS/GCP/Lambda/RunPod/etc., paid
for separately) or the owner's own machine if it ever gets a GPU.

**MoisesDB itself** (researched, not downloaded):
- 240 songs, ~45-47 artists, 12 genres, ~14h24m total — a real dataset
  built for exactly this (hierarchical stems beyond the usual 4,
  including guitar/piano/strings/wind categories).
- License: CC BY-NC-SA 4.0 — compatible with this project's "private,
  personal, non-distributed" ground rule.
- Access: `pip install moisesdb` gets the Python library, but the
  actual audio requires going to music.ai/research's download page and
  clicking through there — not a bare public URL. Total size isn't
  published anywhere found; a rough estimate from the stated duration
  and a hierarchical multi-stem-per-song structure puts it at tens of
  GB, plausibly more. This session has ~11GB free, nowhere near enough
  for the likely full size regardless of the GPU question.
- Deliberately not downloaded even a subset: no GPU to use it with yet,
  and the download page's click-through wasn't tried on the owner's
  behalf without them actually being present for whatever agreement
  that involves.

**What a real attempt needs, when both blockers are gone**: a GPU
environment, the owner personally completing MoisesDB's download step,
enough disk for the dataset plus checkpoints, Demucs's own training
code (not audio-separator, which is inference-only) to continue
training from the existing `htdemucs_6s` checkpoint on a MoisesDB
subset (not from scratch), and — same rule as everywhere else in this
project — scoring before/after against real held-out stems through this
same harness before trusting it over the current models. "Jacob's
Ladder"'s flagged high-synth/falsetto confusion (next section) is a
ready-made before/after test case once that's possible.

### Rush multitrack search

Checked archive.org directly (same method `CONTRIBUTING.md` describes):
zero results for "jacobs ladder multitrack" and zero for "rush
multitracks stems remix." Rush's active years mostly predate the
2000s–2010s remix-stem-release culture NIN/Radiohead/Linkin Park
participated in (this catalog's other sources) — no evidence they ever
did anything comparable. Nothing to add to the catalog from this; the
Jacob's Ladder vocal-bleed finding stays a flagged observation, not a
scored catalog entry, until/unless that changes.

## Phase 3 status — transcription working, note editing not started (2026-10-05)

Built: `app/transcription.py` converts each pitched stem to MIDI, run
automatically after separation and on demand from a **Transcribe**
button. Basic Pitch for "other", pYIN (librosa) for vocals and bass, per
the architecture above; drums are skipped and the UI says why. Results go
to `storage/midi/<upload>/<stem>.mid` and a `midi_tracks` table. The
player draws each stem's notes as a piano roll aligned under its
waveform, with a moving playhead, click-to-seek, a **Synth** toggle (plays
the notes through a simple WebAudio synth alongside the real audio, to
judge the transcription by ear), and a **MIDI ↓** download with a General
MIDI instrument set per stem. `tests/smoke_transcription.py` drives the
real code on synthetic audio with known notes.

Measured on "Noah's Dove" (4:34) on the target laptop:

| Stem | Method | Time | Notes | Range |
|---|---|---|---|---|
| bass | pYIN | 24 s | 353 | E1–F2 |
| vocals | pYIN | 25 s | 473 | F3–B5 |
| other | Basic Pitch | 13 s | 3,365 | F1–B6 |

About a minute in total, ~1% of separation time — which is why it runs
automatically rather than being opt-in.

Departure from the plan: **Basic Pitch 0.4.0 is installed with
`--no-deps`.** Its metadata requires TensorFlow < 2.15.1, which has no
Python 3.12 build, so pip falls back to a 2022 release that needs a numpy
it can't build. The package ships its model as ONNX too, and onnxruntime
is already installed for separation, so TensorFlow isn't needed at all.

Also fixed in the player while here: clicking one stem's waveform used to
seek only that stem, putting the others out of sync; and switching
uploads left the previous song's audio loaded (and playing, if it was).

### Known weaknesses, not yet addressed

- **No accuracy measurement on real music yet** — the phase 1 rule
  ("measured, not eyeballed") isn't met for transcription. It needs real
  audio with aligned ground-truth MIDI. Slakh2100 (multitrack audio
  rendered from MIDI, with stems and the source MIDI aligned) fits this
  project unusually well because it gives ground truth for separation
  *and* transcription per instrument; check its license and size first.
- **Basic Pitch over-detects**: 16 notes for 12 real ones on synthetic
  chords (likely overtones read as notes), and 3,365 notes on a dense
  "other" stem. Its thresholds are library defaults; tune only against
  ground truth.
- **pYIN shows occasional isolated high notes** on vocals (octave errors
  or breaths). A cheap sanity check that pitch numbering is right: on
  "Noah's Dove" all three stems' most common pitch classes fall in one
  seven-note scale.
- **Drums**: now transcribed by a heuristic (see the addendum below) —
  not a trained model, not measured, and the one sanity check available
  (snare count) suggests it's miscalibrated.
- **Notes aren't on a beat grid** — real seconds, tempo 120 in the MIDI
  file. Beat tracking is needed before MusicXML/notation export.

### Note editor decision — resolved 2026-10-06

Owner chose **option 1**: extend this app's own piano roll rather than
fork Signal. Built — see the next section.

## Phase 3 addendum — note editing, drums, master transport (2026-10-06)

### Note editing

`app/static/pianoroll.js`'s `createPianoRoll()` makes each stem's canvas
interactive: click empty space to add a note (default length 0.3s,
velocity 100), drag a note to move it, drag within ~7px of its right
edge to resize, click to select, Delete/Backspace to remove. Every
discrete edit (not every mid-drag frame) calls `onChange(notes)`, which PUTs
to `/api/uploads/{id}/midi/{stem}/notes` and rewrites that stem's `.mid`
file via `transcription.save_notes()` — immediate, no save button.

One real bug caught while testing this against the running server (not
just read by eye): the mouseup handler reset `selected = -1`
unconditionally after sorting the notes array by start time, which
silently broke "click to select, then press Delete" — a fresh click
would select correctly, but the very act of releasing the mouse erased
that selection before any key could use it. Fixed by capturing the note
*reference* before the sort and re-finding its new index with
`indexOf()` afterward, since sorting reorders array positions but not
object identity. Caught by driving the real running app end-to-end in
the browser (adding, saving, reloading, and confirming via direct API
calls), not by reading the code — the logic looked correct on inspection.

### Drum transcription — a heuristic, explicitly not a trained model

Spent real effort trying to avoid building this by hand first:

- **madmom** (the standard onset/beat-tracking library): unmaintained.
  `pip install` fails outright (needs Cython in the build-isolation
  environment); forcing `--no-build-isolation` gets it to install, but it
  then fails to *import* (`collections.MutableSequence`, removed from
  Python in 3.10) and, after patching that one line, fails again
  (`np.float`, removed from numpy in 1.24). Both APIs were deprecated for
  years before removal — this is a library nobody has updated for the
  Python/numpy most of this project already runs on, not a one-line fix.
  Abandoned rather than continuing to patch a dead dependency.
- **omnizart** (has a drum-transcription mode): needs `pyaudio`, which
  needs the system's PortAudio headers (not installed, needs `sudo apt`),
  and separately needs TensorFlow, which hits the exact same
  no-Python-3.12-build wall Basic Pitch did.

Built instead, in `app/drum_transcription.py`: onset detection
(`librosa.onset.onset_detect`) finds hit times, then each hit is
classified into kick/snare/closed-hi-hat by where its energy sits in the
spectrum (low-frequency-dominant → kick, high-frequency-or-noisy →
hi-hat, else → snare) — the same kind of cheap, explainable heuristic
`stem-shootout/scripts/classify_tracks.py` already uses elsewhere in this
project, not a trained classifier.

**Not measured, and the one real check available is a bad sign**: on
Mr Shankley's drum stem (364 onsets), the classifier found 346 kicks, 13
snares, and the rest hi-hats — a 13-snare count for a full rock song is
implausible (snare usually anchors beats 2 and 4 throughout) and points
at miscalibrated thresholds, specifically that too much is falling into
the kick bucket. Didn't hand-tune it: adjusting thresholds without ground
truth just moves the error somewhere else convincingly. Fix by scoring
against real drum-hit ground truth (Slakh2100 again, or any MIDI-aligned
multitrack set with a real drum part) before trusting the output, the
same rule applied everywhere else in this project.

### Master transport and the sync-drift finding

`app/static/player.js` adds Play all / Pause all / Stop all, a combined
timecode, and a click-anywhere seek bar driving every stem's
`wavesurfer.setTime()` together, plus a live per-stem timecode. Built
because the owner asked to see exactly where every stem is in time, not
just assume they match.

That turned up a real, measured finding: after 7.6 seconds of
synchronized playback (all stems started together via the existing
seek-sync code), the four stems' internal clocks had already drifted
about **1.4 milliseconds** apart (7.614967s vs 7.613537s). Each stem is
an independent `<audio>` element with its own playback clock — nothing
currently forces them to stay locked together, only to start together.
Inaudible at this scale, untested over a full song or many pause/resume
cycles. A real fix (if it ever becomes audible) is loading all stems as
`AudioBuffer`s into one shared `AudioContext` and triggering them from a
single clock, which is a bigger change than this session made — not
attempted here, flagged for whoever hits it.

### Drum synth voices

The existing WebAudio preview synth played every note as a tuned
triangle-wave oscillator, which would make drum hits sound like random
pitched beeps — GM drum note numbers (36/38/42) aren't tones. Added
`drumVoice()` in `pianoroll.js`: a pitch-dropping sine thump for kick, a
filtered noise burst for snare/hi-hat. Confirmed via the browser that
toggling a drums stem's Synth button actually creates `AudioBufferSourceNode`
and `OscillatorNode` instances, not the tonal voice path.

## Phase 3 addendum 2 — editing workflow, undo, zoom, master-bar alignment (2026-10-06)

Everything below was requested and built in the same local session, tested
live in the browser (not just read over) after a few false alarms turned
out to be the browser caching the old `/static/*.js` during iterative
testing, not real bugs — a fresh tab (not just a reload) was the reliable
way to confirm a change actually took effect. Worth remembering for
whoever edits `app/static/*.js` next.

- **Editing is no longer auto-saved on every change.** Each roll keeps a
  local in-memory buffer; **Save** (PUT to the server) and **Revert**
  (discard the buffer, reload the last-saved notes) sit to the left of
  each piano roll. The caption shows "unsaved changes" vs "saved" so it's
  never ambiguous which state you're looking at.
- **Ctrl+Z undoes the most recently edited roll**, globally — not scoped
  to whichever element has keyboard focus. Each roll keeps its own
  snapshot stack (capped at 50), pushed once per discrete action (not per
  drag frame), so one undo reverses one whole gesture, including a batch
  delete.
- **Ctrl+drag marquee-selects multiple notes**; Ctrl+click toggles one
  note in/out of the selection; Delete/Backspace removes everything
  selected in one action. Selection is tracked by note *object reference*,
  not array index — the earlier select-then-delete bug (see the previous
  addendum) was exactly an index going stale after a sort, so this time
  the data structure rules that whole bug class out rather than patching
  around it.
- **Per-roll zoom** (🔍+/🔍−, up to 24x): widens the roll's own scrollable
  inner element; the browser's native horizontal scrollbar handles
  panning, no custom pan code needed. Independent per stem, not
  synchronized across tracks — zooming vocals doesn't zoom bass.
- **Editing now makes a sound even when nothing is playing and Synth is
  off.** Investigated "adding notes doesn't change the sound" by actually
  reproducing it rather than guessing: the playback-synced synth was
  already working correctly (confirmed by instrumenting it live), the
  real problem was that edits were only ever audible if you happened to
  have Synth on *and* be actively playing past that exact point — an easy
  state to not be in. Fixed by giving every add/move/resize an instant
  one-shot preview sound of its own, independent of the transport.
- **Master seek bar now sits directly under Play/Pause/Stop, aligned
  pixel-for-pixel with the waveforms beneath it.** First attempt used a
  hardcoded CSS margin assuming the roll started right after the track's
  own padding — broken the moment the Save/Revert/zoom button column was
  added to the left of each track, since that column's width depends on
  font/emoji rendering, not a fixed number. Fixed by measuring a real
  waveform's actual rendered position in JS (`alignMasterBar()`) and
  setting the bar's margins to match exactly, redone on window resize.
  Verified with real `getBoundingClientRect()` comparisons, not by eye:
  0px difference on both edges, and a click at a given fraction of the
  bar lands within rounding of that same fraction of song duration.

Not done: zoom doesn't affect the waveform above each roll (only
WaveSurfer's own fixed-width overview), so at high zoom the roll and its
waveform stop lining up with each other — the master bar's alignment
promise above is about the *unzoomed* overview only. Synchronizing zoom
across the waveform and every stem's roll together is a bigger change
(WaveSurfer has its own zoom API that would need to be driven in lockstep
with each roll's) and wasn't attempted.

## Cloud research task continued: the hardware question (2026-10-06)

The owner asked directly: is further "other" splitting (per-instrument
classical/orchestral separation especially) blocked by hardware, or not?
Short answer, stated precisely because the honest version has two parts
that are easy to conflate: **not by this laptop's CPU vs. a GPU, for the
models already in hand — those would just run faster. It is blocked by
what those models were ever trained to recognize, and genuinely fixing
that does need a GPU, just for training, not for running what already
exists.**

### Why this isn't a speed problem

Neural network inference is deterministic: the same checkpoint run on
the same input produces the same output on a CPU or a GPU, just at
different speed. `htdemucs_6s`'s guitar/piano separation was already
measured as poor (-6.13dB SDR, -33dB SIR on guitar) running on this
container's CPU. Running that exact checkpoint on an RTX 4090 would
produce byte-identical numbers, just in under a minute instead of ~15.
A GPU does not make an existing model better at a task it wasn't trained
for — it only makes the wrong answer arrive faster.

### A real experiment: Beethoven's 5th on today's best "many stems" model

Found real orchestral ground-truth datasets exist (URMP, 12.5GB/
registration-gated with a smaller ungated sample; the brand-new Spheres
dataset, Oct 2025, Tchaikovsky/Mozart, CC BY-SA 4.0, no registration —
but its isolated-stems archive is 25.3GB, more than this session's
~11GB free disk) but getting one set up and scored was its own multi-hour
task on top of everything else here, so instead ran the one experiment
that fits in this session: downloaded a real, public-domain, full-
orchestra recording (Beethoven's Symphony No. 5, 1st movement, Musopen
recording via archive.org — see "sourcing friction" below for why
archive.org specifically) and ran `htdemucs_6s` on it. No isolated
ground truth exists for this recording, so this is **not** a scored
result like everything else in this catalog — it's a measured
*characterization* of the failure, not a SDR number:

| output bucket | % of mixdown RMS |
|---|---|
| other | 78.1% |
| guitar | 35.0% |
| piano | 19.2% |
| vocals | 12.8% |
| drums | 12.4% |
| bass | 12.0% |

(These sum past 100% because the buckets aren't energy-exclusive here —
more on that below.) Most energy correctly landing in "other" is the
*least* wrong part. The striking part: **35% of the mixdown's energy
got pulled into "guitar," 19% into "piano," 13% into "vocals"** — a
symphony orchestra has none of those. Checked whether this was just the
same content copied into multiple buckets (correlation between guitar/
vocals/piano and "other": 0.004–0.18, i.e. no) — the model is genuinely
decomposing the real orchestral signal into pieces it mistakes for
guitar, piano, and singing, each a real but wrongly-labeled slice of the
sound. That's the mechanism, concretely: **the model doesn't fail by
doing nothing; it fails by confidently mis-sorting real content into
categories that don't apply**, because sustained legato strings/winds
share enough timbral territory with "vocals," certain string textures
with "guitar," and so on. This is the same failure mode already flagged
for Jacob's Ladder's high-synth/falsetto confusion — now shown to
generalize to orchestral strings and winds too, not a one-song quirk.

### What's actually needed for real per-instrument separation

Researched the current state of the art looking specifically for
anything beyond today's fixed 4-6-stem taxonomy:

- **Banquet** (`github.com/kwatcharasupat/query-bandit`, Watcharasupat &
  Lerch, 2024) — a genuinely different approach: one small (24.9M
  parameter) model takes a *query* (an example audio clip of the target
  instrument) instead of a fixed output list, so it can separate
  "clean acoustic guitars," "reeds," "organs" — arbitrary classes, not
  just what a training run happened to include as named outputs. Per
  its paper, it already *outperforms* 6-stem Hybrid Transformer Demucs
  on guitar and piano specifically, at a fraction of the parameters.
  Pretrained weights are published (Zenodo, CC BY-NC-SA 4.0 — compatible
  with this project), and its own code confirms CPU inference is a real
  supported path (`accelerator="gpu" if torch.cuda.is_available() else
  "cpu"`, `use_cuda=False` does `system.cpu()`), not a GPU-only tool.
  **This is the most promising concrete next step, and it does not need
  a GPU to try.** It is, however, a real integration task: no
  `requirements.txt`/packaging, a custom architecture with its own
  dependencies (a PaSST audio-tagging submodel among them) — cloned the
  repo and confirmed this firsthand rather than assuming it from the
  README. Didn't attempt the full dependency setup this round (the
  research task above already used most of this session's time) — a
  fair estimate is a few focused hours for someone able to iterate on
  its actual dependency list, not a GPU-bound effort.
- **AudioSep** (`github.com/Audio-AGI/AudioSep`) — the more general
  cousin: text-query separation ("separate anything you describe"),
  published results include 10.51dB SDR improvement specifically on a
  music-instrument benchmark. Explicitly supports CPU ("can run on CPU
  with reduced performance"), though its checkpoint and conda-based
  setup looked heavier than Banquet's — worth trying second, not first.
- **Training data for a real fine-tune, if Banquet/AudioSep aren't
  enough on their own**: MoisesDB (scoped already, two sessions ago —
  registration-gated, CC BY-NC-SA 4.0), the new **Spheres** dataset
  (orchestral-specific, Tchaikovsky/Mozart, CC BY-SA 4.0, no
  registration, 25.3GB for real isolated-stem ground truth), and
  **URMP** (classical chamber pieces specifically, 12.5GB full set
  registration-gated, a single ungated sample piece available). All
  three now exist and weren't on anyone's radar before this round of
  research — write this down so a future session doesn't have to
  rediscover them.

**This is where a GPU is a genuine, not optional, requirement**: training
or fine-tuning any of these architectures at a usable speed needs one —
not because this laptop's CPU is unusually weak, but because deep-model
training is structurally GPU-bound industry-wide (the Banquet paper
itself cites training batches sized for an RTX 4090). Running inference
on an already-published checkpoint (Banquet, AudioSep, or even today's
`htdemucs_6s`) does not have that requirement; it's purely an engineering/
integration task, and CPU-only hardware like this laptop is a real option
for it, just a slower one.

### Bottom line, directly

- **Buying a GPU and running today's existing checkpoints on it would
  not fix per-instrument/orchestral separation.** The numbers would be
  identical to what's already been measured on CPU, just faster to get.
- **The actual path to more stems is**: try Banquet (and/or AudioSep)
  first — real engineering time, no GPU required, could genuinely
  deliver more stem categories than today's fixed taxonomy without any
  training. If that's not sufficient, fine-tune on Spheres/URMP/MoisesDB
  — **this step does need a GPU**, as a hard practical requirement, not
  a nice-to-have. If the owner wants to invest in a GPU machine, that's
  the point where it would actually pay off — not for making the current
  app faster, but for enabling that fine-tune.
- Scored, not guessed: the next time either Banquet or a fine-tune gets
  tried, run it through this same harness (`score.py`/
  `aggregate_results.py`, already generalized to handle arbitrary
  bucket sets) against real ground truth (Spheres/URMP once staged, or
  the catalog's existing guitar/piano cases) before trusting it — same
  rule as everywhere else in this project.

### Sourcing friction (a smaller, secondary finding)

Asked to find classical source material from somewhere other than
archive.org specifically. Tried, in order: Wikimedia Commons (upload
servers returned a genuine rate-limit error naming the shared egress
IP, not a guess — confirmed by reading the actual response body),
Musopen.org directly (blocked outright), IMSLP (served a JS-based bot
CAPTCHA challenge page), the Library of Congress's National Jukebox
(403). Four different platforms, four different automated-access
protections, zero successes. archive.org — which also hosts enormous
amounts of genuinely public-domain classical/orchestral material,
including Musopen's own professionally-recorded symphonies — has never
once blocked anything in this entire project. Owner approved falling
back to archive.org for this one file given that pattern. Worth knowing
going forward: sourcing classical ground-truth test material from
"somewhere else" is a real, repeated point of friction, not a one-off;
budget for it, or expect to end up back at archive.org anyway.

## Phase 3 addendum 3 — shared-clock playback engine, replacing per-stem drift (2026-10-06)

Rebuilt how audio actually plays, to fix the drift documented in the
first Phase 3 addendum (four stems measured ~1.4ms apart after 7.6s of
"synced" playback). Root cause: each stem was its own WaveSurfer
instance, each backed by its own `<audio>` element, each with its own
independent playback clock — nothing kept them locked together, only
started together.

**New: `app/static/audioengine.js`.** Every stem is fetched and decoded
once into an `AudioBuffer`; `engine.play()` creates one
`AudioBufferSourceNode` per stem and starts every one of them with the
exact same `when` and the exact same buffer offset, in one synchronous
loop, against one shared `AudioContext`. That's not a measured
improvement, it's a structural guarantee — confirmed directly by
intercepting every `createBufferSource().start()` call during a real
play: all four stems' `when` and `offset` were bit-for-bit identical
(`51.18533333333333`, both times). There's no longer a per-stem clock to
compare, which is the actual fix, not just a smaller version of the
old problem.

WaveSurfer instances stay, muted (`setVolume(0)`), purely to draw each
waveform and handle click-to-seek — `engine` is what produces sound and
owns the transport. The synth (note-preview audio from the piano roll)
now shares the same `AudioContext` via `engine.ensureContext()` instead
of creating its own, so there's exactly one audio clock on the page, not
two. Mute/solo/volume now route through `engine.setMuted/setSoloed/setVolume`.
Decoding all four stems takes under 3 seconds on the target laptop; the
transport is disabled with a "Loading audio engine…" message until that
finishes.

Verified live, not just by construction: sample-accurate scheduling
(above), mute/solo/volume gain routing, pause holding position exactly
with zero drift while paused, resume continuing correctly, and waveform
click-to-seek.

### A real, reproducible bug found while testing this — not the engine's fault

Testing waveform click-to-seek with synthetic DOM events initially
produced nothing, then investigating piano-roll note creation the same
way produced a note with **pitch -112** — 112 semitones below MIDI's
valid range, corrupting that stem's displayed pitch range to "NaN" (a
second, smaller bug: `noteName()` didn't handle negative pitches, since
JS's `%` keeps the dividend's sign — fixed alongside).

Root cause, confirmed by instrumenting the actual code path and
reproducing it twice identically: `createPianoRoll`'s mousedown handler
called `canvas.focus()` *before* computing the click's position from
`canvas.getBoundingClientRect()`. If the roll wasn't already fully
scrolled into view, focusing it made the browser auto-scroll the page —
which moved the canvas between when the click was dispatched and when
the handler read its position, so the position was computed against the
*post-scroll* rect while the original screen coordinates were now
pointing somewhere else entirely. A real, reachable bug: any click that
also happens to scroll the roll into view is enough to trigger it,
not something synthetic about the test.

Fixed three ways, not just the proximate one: positions are now read via
`e.offsetX`/`e.offsetY` (computed by the browser at dispatch time,
immune to any later layout shift) instead of re-deriving them from a
fresh `getBoundingClientRect()` call; `canvas.focus()` moved to *after*
position is read, as defense in depth; and `xyToTimePitch()` now clamps
pitch to \[0, 127] unconditionally, so even an unforeseen variant of this
bug class can't write a nonsensical note into the data again.

### Not done

Zoom still doesn't extend to the waveform (per the previous addendum).
Decoding duplicates work WaveSurfer already does internally for its own
waveform rendering — each stem's audio is now fetched and decoded twice
(once by WaveSurfer for display, once by the engine for playback). Fine
on localhost with files this size; would be worth revisiting if stems
get much larger or this ever serves more than one user at a time.

## MuScriptor (multi-instrument transcription) — measured, mixed result (2026-10-08)

Investigated whether transcribing "other" with per-instrument labels
(rather than trying to separate it as audio) could sidestep the poor
guitar/piano audio-separation numbers above. Found
[MuScriptor](https://ai.miraheze.org/wiki/MuScriptor) (Kyutai/Mirelo/IRCAM,
July 2026) — transcribes mixed audio directly into instrument-labeled
MIDI events in one pass. Real, pip-installable (`pip install muscriptor`),
weights gated on Hugging Face (free account + accept the model's license
page + a token — none of that is pip's problem, it's a one-time manual
step per machine).

**Speed, small/CPU model**: ~1.6x real-time (273.6s audio in ~445-450s)
on the target laptop — far better than the karaoke Roformer model's
~15-20x. One warning in 55 chunks ("didn't emit EOS within budget"),
handled gracefully, didn't crash.

**Measured classification accuracy, isolated ground truth** (the real
`Ac__Guitar`/`El__Guitar`/`Piano` tracks from `a_light_that_never_comes`'s
archive.org source, transcribed alone — a direct test of instrument
labeling, not full-mix separation):

| Track | Ground truth | Result |
|---|---|---|
| Ac__Guitar.flac | acoustic guitar | **100%** labeled `acoustic_guitar` |
| El__Guitar.flac | electric guitar | **100%** labeled an electric-guitar subtype (60% clean, 40% distorted) |
| Piano.flac | piano | **0%** correct — 99.4% labeled `clean_electric_guitar`, rest `electric_bass` |

Guitar acoustic-vs-electric: essentially perfect. **Piano vs. guitar: a
real, complete failure on this test**, not noise — not "mostly right with
some confusion," confidently wrong almost every time. This directly
undercuts an earlier, less rigorous read from running it on Noah's
Dove's "other" stem (which reported a plausible-looking ~2,251
piano-labeled / ~110 guitar-labeled split) — that result can no longer be
trusted without re-checking, since the same model aced guitar and failed
piano on known-clean input.

**Likely explanation, not confirmed**: only the "small" (103M param)
model is documented to run on CPU; the published Multi F1 48.2 benchmark
was measured on "large" (1.4B params), which needs a GPU. Plausible the
small model simply lacks the capacity for this specific distinction —
untested here. If this gets picked up again, the medium or large variant
on a GPU (the cloud session may have one, worth checking) is the next
real test, not writing this method off entirely from one small-model
result.

**Not done / open**: re-running MuScriptor directly on Noah's Dove's
"other" stem now that piano-labeling specifically is suspect; testing
whether running on isolated tracks (clean signal) vs. a blended "other"
stem (post-separation, already-degraded signal) changes accuracy at all;
medium/large model variants.

## MuScriptor on real orchestral multi-instrument audio (2026-10-08, corrected same day)

> **Correction.** The first version of this section (commit `abe84af`)
> reported 6.3% note recall. That number was wrong — a bug in *our*
> ground-truth parser, not the model: Slakh's MIDI files keep the tempo
> map in track 0 and the notes in track 1, and the parser iterated each
> track separately, so it assumed the default 120 BPM and misplaced every
> ground-truth note (the flute's first note is at 94.9s; we had it at
> 49.5s). Fixed by iterating the merged file (`for msg in MidiFile(...)`),
> which is tempo-aware. Everything below is re-scored. **Lesson for any
> future MIDI ground truth here: never walk per-track with a default
> tempo.**

Source: [BabySlakh](https://zenodo.org/records/4603870) (Zenodo, CC-BY
4.0) — 20 research tracks rendered from MIDI with professional sample
libraries, exact aligned MIDI per instrument. `Track00006` has the most
acoustic-orchestral instrumentation in the set: 2× trumpet, French horn,
trombone, alto sax, flute, 2× string ensemble — 729 notes over 4m6s.
Summed those 8 stems (no drums/bass/guitar/piano, mirroring an "other"
stem) and transcribed the mix. Scoring matches notes by pitch (±1
semitone) and onset (±150ms), like `mir_eval`, then separately checks the
instrument label of each matched note.

| Method | Note recall | Note precision | Instrument label correct (matched notes) |
|---|---|---|---|
| Basic Pitch (what the app uses for "other" today) | 45.1% | 21.6% | n/a — no labels |
| MuScriptor small, unconstrained | 50.1% | 14.0% | **0%** — every note → `acoustic_piano`; plus 1,857 phantom `drums` notes |
| **MuScriptor small, `--instruments` = the 6 true classes** | **58.8%** | **34.1%** | **51%** overall |
| MuScriptor small, solo flute stem alone, unconstrained | 41.9% | 30.7% | 0% (→ `acoustic_piano`) |

Per-instrument accuracy in the constrained run: trumpet 82% (182/223),
French horn 60%, alto sax 27%, trombone 21%, strings 15%, flute 0% (mostly
called sax or trumpet).

What this means:
- **Note detection is fine; naming is the problem.** Unconstrained, the
  small model hears the notes (better than Basic Pitch) but collapses
  every orchestral timbre to piano and hallucinates a drum part —
  the "instrument leakage" failure the 2025 AMT Challenge names.
- **`--instruments` is a big lever.** Forbidding classes that aren't
  there removed the phantom drums, more than doubled precision, and took
  label accuracy from 0% to 51%. Caveat: this run was given the exact
  true list (a best case). In the app that list would come from the user
  ("this song has horns and strings") or from an instrument-detection
  pass — still to be measured.
- Constrained MuScriptor-small **beats the app's current Basic Pitch path
  on note recall and precision while also labeling instruments** —
  a genuine positive, not just a less-bad negative.
- Still not established: the medium model (`MuScriptor/muscriptor-medium`
  has its *own* Hugging Face license gate, separate from small's; the
  owner needs to accept it once before it can download), and whether the
  piano→guitar confusion in the Linkin Park test above also clears up
  with `--instruments`.

Model weights verified intact (393MB once HF cache symlinks are
followed). Speed: ~1.05× real time (small), Basic Pitch ~0.13× real time.
Artifacts (session scratch, not in repo): `orchestral_gt.json`,
`build_orchestral_test.py` (fixed parser), `score_orchestral_test.py`.

## Field survey: who else is splitting "other", and how (2026-10-08)

Prompted by the MuScriptor failure above — the owner asked not to give up,
and to find out what everyone else is doing. Researched the same day;
nothing below has been *run* here yet. Sources are linked so the next
session can verify rather than trust.

### The headline: our 6-stem baseline is five years behind the leaderboard

The project's only guitar/piano separation test so far was `htdemucs_6s`
(Demucs, 2022): **-6.13 dB** guitar, **0.01 dB** piano. The public
[MVSEP guitar leaderboard](https://mvsep.com/quality_checker/leaderboard/guitar/?sort=guitar)
and [piano leaderboard](https://mvsep.com/quality_checker/leaderboard/piano)
— the community benchmark the whole open-source separation scene scores
against — have **BS-RoFormer-SW** at **+9.01 dB guitar / +7.80 dB piano**,
ahead of Apple's Logic Pro 11.2 Stem Splitter (9.00 / 7.79). Same six
stems as `htdemucs_6s` (vocals, drums, bass, guitar, piano, other), open
weights (~700 MB, `jarredou/BS-ROFO-SW-Fixed` on Hugging Face; community-
trained, weight license not formally stated), and a pip package that runs
it on CPU: [`bs-roformer-infer`](https://github.com/openmirlab/bs-roformer-infer)
(MIT, `device="cpu"` supported, SHA-verified auto-download). Not in
`audio-separator`'s model list, which is why the earlier survey missed it.
Caveat from the lead/backing test above: Roformer checkpoints ran 15-20x
slower than MDX-Net on this CPU — budget an hour or two per song.

### The rest of the landscape

- **MVSep Mega 53-stem** ([release](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.21),
  [HF mirror](https://huggingface.co/noblebarkrr/BS-Roformer-MVSep-Mega-53-stems),
  [MVSEP page](https://mvsep.com/algorithms/135)) — BS-RoFormer, 53 output
  classes including trumpet, trombone, french-horn, flute, oboe, clarinet,
  bassoon, violin, viola, cello, strings, timpani, harp, organ… Detects
  which instruments are present and only emits those. Upstream: "at least
  16 GB VRAM", stems don't sum to the mix, and per-instrument quality is
  below dedicated single-instrument models — MVSEP itself recommends it as
  a *discovery* pass, then specialist models per detected instrument.
  This laptop has 11 GB RAM total; likely infeasible here without a
  rented GPU. Weight license/training-data provenance is an open question
  ([issue #255](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/255),
  unanswered as of 2026-10-02).
- **Cascades on top of SW**: the SJTU X-LANCE system that won the
  [MSR Challenge 2025](https://arxiv.org/html/2602.09042v1) runs frozen
  BS-Rofo-SW, then fine-tuned models that split "other" into synthesizer /
  percussion / orchestral elements. Code + checkpoints:
  [ModistAndrew/xlance-msr](https://github.com/ModistAndrew/xlance-msr) (MIT).
- **Query-based separation** (describe or demonstrate the target instead
  of a fixed stem list): Banquet (above, still untried; a text-query
  variant exists, [Language-Audio-Banquet](https://huggingface.co/spaces/chenxie95/Language-Audio-Banquet),
  GPU-oriented); [AudioSep](https://arxiv.org/html/2308.05037); Meta's
  [SAM Audio](https://ai.meta.com/research/samaudio/) (Dec 2025, text /
  visual / time-span prompts, 500M–3B params, open weights under a custom
  "SAM License", GPU-focused, own paper admits text-queried instrument
  separation "significantly lags" Demucs-class specialists).
- **Transcription side**: the [2025 AMT Challenge](https://arxiv.org/html/2603.27528)
  (8 teams, 8 orchestral instruments) — best multi-instrument F1 **0.60**
  vs MT3's 0.39, and *every* system lost ~0.3 F1 going from 1 to 3
  simultaneous instruments; "instrument leakage" (hallucinating absent
  instruments — exactly our drums result) named as a core failure mode.
  Winner built on [YourMT3+](https://github.com/mimbres/YourMT3).
  [Harmonica](https://arxiv.org/html/2609.04640) (Sept 2026): a 26K-param
  instrument-agnostic note detector beating Basic Pitch by +0.21 frame F1
  on Slakh stems at 1,600x real-time — code not yet found.
  **MuScriptor has an `--instruments` flag** that forbids decoding any
  class not listed — never used in our tests; cheap to retry with it.
- **Orchestral ground truth now exists**: [Spheres](https://zenodo.org/records/17347681)
  — real orchestra, every instrument recorded in isolation, CC BY-SA 4.0,
  no registration; the **2.8 GB stereo subset** has per-instrument stems
  plus mixes. Its baseline (X-UMX) got strings from 4.5 → 9.4 dB SDR.
  Fixes the "no orchestral ground truth in the catalog" gap cheaply.
- **A near-twin project**: [SteMidi-Studio](https://github.com/DigitLib/SteMidi-Studio)
  — Mega-53 separation → MuScriptor (medium/large) → web piano roll.
  Alpha, 0 stars, 3 commits, GPU-first (6 GB VRAM minimum). Same idea as
  this app, different bets: they assume a GPU and the biggest models; we
  assume a CPU and measure everything. Its README notes instrument
  conditioning "reduces hallucinated notes" — consistent with the
  `--instruments` idea above.
- **Commercial proof it's doable**: LALAL.AI (10 source types incl.
  strings/wind/synth), Moises, AudioShake, Logic Pro — all closed, all
  shipping guitar/piano stems today.

### Ideas nobody in that list is doing, that this project is positioned for

- **Score-informed separation using our own edited piano roll as the
  score.** Published as a research direction
  ([arXiv 2503.07352](https://arxiv.org/html/2503.07352v1), classical
  music) but no shipping tool lets a user *correct* the score and re-run.
  We already have the editor.
- **Stereo-position extraction** for the Bohemian-Rhapsody-style cases
  (flagged earlier, still untried) — not a neural model at all.
- **Publishing measured results, including negatives.** Our MuScriptor-small and
  `htdemucs_6s`-on-orchestra results don't exist anywhere else in
  measured form; the MVSEP quality checker accepts submissions, and the
  MuScriptor repo would benefit from an issue with the numbers.
