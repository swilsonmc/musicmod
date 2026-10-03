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

Location: `stem-shootout/` in this repo. **The harness is built, and real
test audio for 3 songs is staged. `audio-separator` itself (the heavy
dependency — pulls torch) has not actually been installed/run yet — that's
the next step, not done as part of acquiring the material.**

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

### Next steps (pick up here, locally or in a further cloud session)

1. `pip install -r stem-shootout/requirements.txt` (pulls torch — this is
   the heavy step not yet done), then `audio-separator --list_models` to
   get current real model identifiers — the ones in each song's
   `config.json` are placeholders, don't trust them blindly.
2. Update each song's `config.json` `"models"` list from that real list.
3. `python scripts/run_shootout.py --config ../data/songs/discipline/config.json`
   (and repeat for `nude`, `a_light_that_never_comes`) — review
   `results.md` per song, sanity-check the printed alignment offset.
4. Compare results across all 3 songs — a model that wins on Discipline's
   dense industrial mix but falls apart on Nude's sparse falsetto (or
   can't separate Lead_Vocals from BG_Vocals on A Light That Never Comes)
   is exactly the kind of thing one song alone wouldn't reveal.
5. Pick the winning model, then move to phase 2 (upload → stems → simple
   multitrack player).
