# Stem-separation model shootout

Phase 1 of the musicmod project: before building anything else, figure out
which AI stem-separation model to standardize on, using real ground truth
instead of a vibe check.

## The idea

Several artists have officially released both a final mixdown *and* the
raw multitrack stems for individual songs — a rare case of having real
ground-truth separated audio for a commercially produced track. The plan:

1. Take the official stereo mixdown of a song.
2. Run it through several AI separation models (Demucs, MDX-Net,
   BS-Roformer/Mel-Band-Roformer, etc. via `audio-separator`).
3. Bus the *real* multitrack stems down into the same 4 canonical buckets
   (vocals/drums/bass/other) the AI models produce.
4. Score each model's output against that real ground truth with
   `museval` (the SDR/ISR/SIR/SAR metric used in the SiSEC/MDX separation
   challenges) — a number, not an impression.

## Status

The harness is built and validated against synthetic data
(`scripts/smoke_test.py`) **and** three real songs' audio is staged under
`data/songs/`. It has not actually been run through `audio-separator`
yet — that needs the heavy deps (`pip install -r requirements.txt`, which
pulls torch) and real model runs, which weren't done as part of acquiring
the test material. See `HANDOFF.md` at the repo root for exact next steps.

## The song catalog (`data/songs/`)

| slug | artist / song | why it's useful |
|---|---|---|
| `discipline` | Nine Inch Nails — "Discipline" (*The Slip*) | CC BY-NC-SA — **both** mixdown and multitracks are the real official files, no synthetic mixdown needed. Industrial/alt-rock, baritone lead + **2 separate harmony layers** (BV, Woo Voc), lots of synth/electronic "other" content (Marimba, Piano, Riff, Tone, Vostok Bass/Riff, Xpander). |
| `nude` | Radiohead — "Nude" (*In Rainbows*) | 5 cleanly-labeled official stems (Bass/Drum/Guitar/String FX/Voice) from a 2008 remix contest, already public on archive.org. Single falsetto lead vocal, sparse/atmospheric — a very different mix density than the other songs. |
| `a_light_that_never_comes` | Linkin Park & Steve Aoki | 8 cleanly-labeled official stems including **separate Lead_Vocals + BG_Vocals** — the clearest harmony-vocal test case in the set. EDM/rock hybrid with a programmed "Effects" layer. |

**Licensing note on `nude` and `a_light_that_never_comes`:** these are
ordinary commercial releases, not CC-licensed. Their *stems* were freely
distributed by the labels/artists for official remix contests and are
already public (hosted on archive.org by third parties) — downloading
those is fine. But there's no independently-sourced official mixdown
available the same way, so `mixdown.wav` for these two is a
**peak-normalized sum of the official stems** rather than the true
mastered single. This is not a workaround or a weakness — it's the same
methodology the standard MUSDB18 separation benchmark itself uses
(mixture = sum of stems). It just means these two test "can a model undo
an unmastered sum of real stems," not "can it undo a loudness-war-mastered
commercial single" — `discipline` is the one case in this set doing the
latter, since both its mixdown and its stems are the genuine official
files.

### Adding more songs

A strong optional addition: **Bon Iver's self-titled album** has full
official multitrack stems on archive.org (item
`bon-iver-bon-iver-full-album-stems`, one ~2GB zip for the whole album,
genre: indie-folk/orchestral with dense multi-tracked falsetto harmonies —
probably the richest harmony-vocal test case available). It needs more
prep work than the three above: the released tracks are deliberately
renamed to unrelated place names (not "Lead Vocal.wav" but things like
"holocene_409/mandolin_wa.wav") specifically so remixers had to listen
rather than cherry-pick, so building `reference_mapping.json` for it means
actually listening to and classifying each track per song — not just
copying filenames. Not done yet; worth it if the three above don't give
enough harmony-vocal signal.

Radiohead also released stems for "Reckoner" (6 stems, explicitly
including separate lead vocal + backing vocals) via the same 2008 remix
program, but it isn't mirrored under an obvious name on archive.org the
way "Nude" is — would need more digging to locate.

## Setup

```bash
pip install -r requirements.txt
audio-separator --list_models     # see current exact model identifiers —
                                   # don't trust names in config.example.json or
                                   # any song's config.json blindly, they're placeholders
```

## Running it

Each song under `data/songs/<slug>/` is self-contained with its own
`config.json` (paths inside it are relative to that song's own folder —
see `config.example.json` for the schema). Run one song at a time:

```bash
python scripts/run_shootout.py --config ../data/songs/discipline/config.json
```

This separates that song's mixdown with every model listed in its
config, aligns the real reference stems to the mixdown's timeline
(cross-correlation — the printed offset is a sanity check, and can
legitimately be tens of seconds: real multitrack sessions often run
longer than the released edit, e.g. Discipline's multitrack is ~50s
longer than the album cut), scores each model, and writes
`results.md`/`results.json` next to that song's `config.json`.

## Design notes

- **Why bus the reference down instead of scoring raw tracks directly?**
  AI models produce exactly 4 buckets (or sometimes 2: vocals +
  instrumental). The real multitracks have a dozen-plus per-instrument
  tracks. Comparing fairly means summing the real tracks into the same 4
  buckets first (`scripts/bus_reference.py`).
- **Why align at all, and why such a wide search window?** The official
  mixdown and the raw multitrack session don't necessarily share the same
  head/tail silence — and per real data, can differ by tens of seconds,
  not milliseconds. Getting this wrong silently tanks every model's score
  by the same amount, which would make the whole comparison meaningless.
  `common.py`'s alignment is a direct FFT cross-correlation (not a
  decimate-then-refine search — an earlier version of that could silently
  lock onto the wrong peak by discarding exactly the transients alignment
  depends on; caught by `smoke_test.py`).
- **Why evaluate all of a model's stems together, not one at a time?**
  `museval`'s SIR (how much of one source leaks into another's estimate)
  is only meaningful when it sees every true source at once. Scoring stems
  one at a time throws that signal away — see `scripts/score.py`'s
  docstring.
- **2-stem models** (vocals + instrumental only, e.g. dedicated vocal
  isolators) are scored against vocals + a derived "instrumental"
  reference (drums+bass+other summed), not against all 4 buckets
  individually — they never claimed to split those apart.
- **All intermediate WAVs are written as 32-bit float, not the default
  16-bit PCM.** Summing independent stems without a mix engineer's gain
  staging routinely produces peaks above 0dBFS (Nude's raw sum peaked at
  +2.5dB) — 16-bit PCM would silently hard-clip that into real distortion
  before a single model even runs.
