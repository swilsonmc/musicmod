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

## Current state: Phase 1 (stem-shootout)

Location: `stem-shootout/` in this repo. **The harness is built and
validated against synthetic data — it has not run on real audio yet.**

What exists:
- `scripts/common.py` — shared audio I/O + FFT-based cross-correlation
  alignment (note: an earlier decimate-then-refine version of this had a
  real bug — it could silently discard the transients alignment depends
  on; replaced with direct FFT correlation and re-validated).
- `scripts/separate.py` — runs any `audio-separator` model over a mixdown,
  canonicalizes its output filenames into {vocals, drums, bass, other,
  instrumental}, records what each model actually produced in
  `manifest.json` (not every model produces all 4 stems).
- `scripts/bus_reference.py` — sums NIN's raw per-instrument multitrack
  files into the 4 canonical buckets, per a JSON mapping you fill in once
  you see the real track list.
- `scripts/align.py` — cross-correlates the busses reference against the
  official mixdown, reports the measured offset (sanity-check it's not
  implausibly large), applies it to each reference bucket.
- `scripts/score.py` — `museval` SDR/ISR/SIR/SAR scoring; evaluates all of
  a model's available stems together in one call (SIR needs every true
  source present at once, not one at a time), handles both 4-stem and
  2-stem (vocals+instrumental) models.
- `scripts/run_shootout.py` — orchestrates all of the above across a
  configured model list, writes `data/results.md` (leaderboard) and
  `data/results.json` (full metric breakdown).
- `scripts/smoke_test.py` — synthetic end-to-end test of the whole
  pipeline (no real audio needed). **Passing.** Caught the alignment bug
  above before it could silently corrupt a real comparison.
- `requirements.txt`, `config.example.json`, `README.md` (full usage
  instructions are in `stem-shootout/README.md` — don't duplicate them
  here).

### What's blocking real data

The cloud session's network egress policy blocks `archive.org` and the
NIN fan-site mirrors (`nin.wiki`, `nindestruct.com`) that host the
official mixdown + multitrack files. This should be a non-issue locally —
your own machine has normal internet access.

Research already done (don't redo it): NIN released the complete official
multitracks for **every song on *The Slip*** (free, CC-licensed, via the
now-defunct remix.nin.com, mirrored on archive.org after the 2016
takedown) and for four songs on *Ghosts I–IV* (which is fully
instrumental, so only useful for drums/bass/other, not vocals — pick a
*Slip* track instead for the full 4-stem test).

### Next steps (pick up here locally)

1. Pick a specific song from *The Slip* with clear vocals/drums/bass/other
   (e.g. a well-known track like "Discipline" — confirm it actually has
   official multitrack stems available before committing to it).
2. Find and download: (a) its official stereo mixdown, (b) its official
   raw multitrack WAV stems — via archive.org's mirror of
   remix.nin.com, or nindestruct.com. Put them under
   `stem-shootout/data/mixdown.wav` and
   `stem-shootout/data/reference_raw/`.
3. Write `stem-shootout/data/reference_mapping.json` (bucket mapping —
   format documented in `scripts/bus_reference.py`'s docstring) based on
   the real track list you now have.
4. `pip install -r stem-shootout/requirements.txt`, then
   `audio-separator --list_models` to get current real model identifiers
   — the names in `config.example.json` are placeholders, don't trust
   them blindly.
5. Copy `config.example.json` → `config.json`, fill in the song name and
   model list.
6. `python scripts/run_shootout.py` — review `data/results.md`, sanity
   check the printed alignment offset isn't implausibly large.
7. Pick the winning model based on the SDR table, then move to phase 2
   (upload → stems → simple multitrack player).
