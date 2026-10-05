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
  `nudestems`), already public. Single falsetto lead, no harmony layer.
  **Not CC** — `mixdown.wav` here is a peak-normalized sum of the official
  stems (same methodology MUSDB18 itself uses for its mixtures), not an
  independently-sourced master. Easiest song in the catalog.
- **`a_light_that_never_comes`** — Linkin Park & Steve Aoki. 8
  cleanly-labeled official stems (archive.org item
  `linkin-park-a-light-that-never-comes-remix-stems`) including
  **separate Lead_Vocals + BG_Vocals** — the clearest harmony-vocal case
  in the set. Same non-CC/synthetic-mixdown caveat as `nude`.
- **`perth`** — Bon Iver. Official stems from the 2012 "Stems Project"
  (archive.org item `bon-iver-bon-iver-full-album-stems`, a ~2GB
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
- **Drums**: needs a dedicated drum-transcription model (e.g. ADTOF);
  nothing is built.
- **Notes aren't on a beat grid** — real seconds, tempo 120 in the MIDI
  file. Beat tracking is needed before MusicXML/notation export.

### Open decision — the note editor (waiting on the owner)

The architecture above picked the open-source **Signal** web piano roll
for editing. Looking closer before building: Signal is a complete
standalone app (React/TypeScript, its own build), not a component, so
using it here means forking it, building it with a Node toolchain, and
adding load-from/save-to-our-server to it — then keeping that fork
current. The alternative is adding editing (select, move, resize, delete,
add notes, save) to the piano roll this app already draws, which is
already aligned to the audio, needs no build step, and stays light on the
target laptop, at the cost of writing and maintaining the editing code
ourselves. The owner was asked which to do; record the answer here.
