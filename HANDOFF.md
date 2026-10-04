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

Location: `stem-shootout/` in this repo. **The harness is built, real test
audio for 3 songs is staged, `audio-separator` is installed, and the full
shootout has been run end to end.** Results and full writeup are in
`stem-shootout/README.md` — the short version:

- **For vocal isolation, use a dedicated vocal/instrumental model**
  (tested: `melband_roformer_instvox_duality_v2.ckpt`) — it beat Demucs's
  bundled vocals output on all 3 songs, by a lot (+5.25dB) on the one with
  real lead+backing-vocal harmony.
- **For the full 4-stem split** (needed for per-instrument editing),
  Demucs is still the pick — `htdemucs_ft` as default, `htdemucs` as a
  faster fallback with a small, inconsistent accuracy cost.
- **Bass and "other" are the weak link everywhere**, worse on denser/more
  produced mixes — plan phase 3+'s instrument-reassignment UI around that
  reality (e.g. don't promise clean guitar/synth re-rendering without
  caveats).

This phase's engineering produced reusable infrastructure, not just one
result — worth knowing about going into later phases:

What exists:
- `scripts/common.py` — shared audio I/O + FFT-based cross-correlation
  alignment. Default search window is 90s, not a couple of seconds — real
  multitrack sessions run a lot longer than the released edit (Discipline's
  is ~50s longer). All WAVs are written as 32-bit float, not the default
  16-bit PCM — summing independent stems without a mix engineer's gain
  staging routinely exceeds 0dBFS (Nude's raw sum hit +2.5dB) and 16-bit
  would silently hard-clip that into real distortion.
- `scripts/separate.py` — runs any `audio-separator` model over a mixdown,
  canonicalizes its output filenames into {vocals, drums, bass, other,
  instrumental}, records what each model actually produced in an
  absolute-path `manifest.json` (not every model produces all 4 stems).
- `scripts/bus_reference.py` — sums per-instrument multitrack files into
  the 4 canonical buckets, per a JSON mapping (one already written per
  song — see below).
- `scripts/align.py` — cross-correlates the bussed reference against the
  official mixdown, reports the measured offset, applies it to each
  reference bucket.
- `scripts/score.py` — `museval` SDR/ISR/SIR/SAR scoring; evaluates all of
  a model's available stems together in one call (SIR needs every true
  source present at once, not one at a time), handles both 4-stem and
  2-stem (vocals+instrumental) models.
- `scripts/run_shootout.py` — takes `--config <song>/config.json`, runs
  that one song end to end, writes `results.md`/`results.json` next to
  its config. Each song under `data/songs/<slug>/` is self-contained.
- `scripts/smoke_test.py` — synthetic end-to-end test of the whole
  pipeline (no real audio needed). **Passing.**

Three real bugs were caught and fixed while building/testing this, all
worth knowing about going in: (1) an early decimate-then-refine alignment
approach could silently discard the exact transients alignment depends on
and lock onto the wrong peak — replaced with direct FFT correlation;
(2) `separate.py` and `score.py` disagreed about what a manifest path was
relative to, which the smoke test's own hand-rolled manifest masked —
fixed by using absolute paths, and the smoke test now drives the real
`separate.py` code instead of reimplementing it; (3) `save_audio` was
defaulting to 16-bit PCM, silently clipping the over-0dBFS synthetic
mixdowns described above — fixed to always write float.

### The song catalog — real audio already downloaded, not committed to git

`stem-shootout/data/songs/<slug>/` (gitignored — audio never goes in git,
only the small `config.json`/`reference_mapping.json` per song do, which
**are** committed):

- **`discipline`** — Nine Inch Nails, "Discipline" (*The Slip*). CC
  BY-NC-SA. Both the official mixdown (`mixdown.flac`) and the official
  multitrack stems (`reference_raw/*.flac`) are the real files — no
  synthetic mixdown needed. 14 raw tracks incl. 3 vocal layers (Lead, BV,
  Woo Voc) — bucketed in `reference_mapping.json`.
- **`nude`** — Radiohead, "Nude" (*In Rainbows*). 5 cleanly-labeled
  official stems from a 2008 remix contest (archive.org item
  `nudestems`), already public. Single falsetto lead, no harmony layer.
  **Not CC** — `mixdown.wav` here is a peak-normalized sum of the official
  stems (same methodology MUSDB18 itself uses for its mixtures), not an
  independently-sourced master.
- **`a_light_that_never_comes`** — Linkin Park & Steve Aoki. 8
  cleanly-labeled official stems (archive.org item
  `linkin-park-a-light-that-never-comes-remix-stems`) including
  **separate Lead_Vocals + BG_Vocals** — the clearest harmony-vocal case
  in the set. Same non-CC/synthetic-mixdown caveat as `nude`.

Full detail, including a strong optional 4th candidate (**Bon Iver's
self-titled album** — dense multi-tracked harmony vocals, full official
stems on archive.org as `bon-iver-bon-iver-full-album-stems`, but the
per-track filenames are deliberately obfuscated to place names so adding
it means actually listening to and classifying each track, not just
reading filenames) is in `stem-shootout/README.md` — don't duplicate that
here, read it there.

### Next steps — phase 2

Phase 1's job (pick a model with evidence, not a guess) is done. Next:

1. Build the upload → stems → simple multitrack player (mute/solo/volume
   only, no editing yet — see "Build order" above).
2. Run separation with **two** models per upload, per the phase 1
   decision: the Roformer vocal specialist for the vocals stem, Demucs
   (`htdemucs_ft`) for drums/bass/other. Don't just pick Demucs's bundled
   vocals output for the sake of simplicity — phase 1 measured a real,
   sometimes large, accuracy cost to that shortcut.
3. If `htdemucs_ft`'s ~4x runtime over `htdemucs` becomes a real UX
   problem on the target laptop (no GPU, 3m21s for `htdemucs` on a single
   4:19 song in this cloud container — expect similar or worse locally),
   it's a legitimate, measured tradeoff to fall back to `htdemucs` by
   default and offer `htdemucs_ft` as a slower "high accuracy" option,
   not a blind guess either way now.
4. Keep an eye on bass/"other" quality in real use — phase 1 showed these
   are inconsistent (near-zero SDR on one of three songs) in a way vocals
   and drums weren't. If that bites in practice, it's worth a dedicated
   bass-isolation model (not evaluated here) rather than assuming Demucs'
   bundled bass/other is good enough everywhere.
