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

## Status: results are in

The harness has been run end to end against all 4 real songs, comparing
two Demucs v4 variants (`htdemucs_ft.yaml`, `htdemucs.yaml`) against two
dedicated vocal/instrumental models of different architectures
(`melband_roformer_instvox_duality_v2.ckpt`, `Kim_Vocal_2.onnx` — a
Mel-Band-Roformer and an MDX-Net model respectively). All on CPU — no GPU
in the environment this ran in.

### Results

The full per-song tables are in each song's own `results.md`/`results.json`
(ISR/SIR/SAR included, not just SDR). **[`LEADERBOARD.md`](./LEADERBOARD.md)**
is the cross-song view and the one worth reading first — it's what
actually revealed the nuances below; a single song's table alone would
have supported a simpler (and partly wrong) story. Regenerate it with
`python scripts/aggregate_results.py` after adding a song or model.

**Perth (Bon Iver) is excluded from the leaderboard averages** — not
because the models did badly on it, but because its reference itself
isn't trustworthy: the raw multitrack files weren't gain-staged
consistently with the mixdown (confirmed automatically — see
`common.py`'s `gain_staging_ratio`, and the real bug/finding story below).
It's still in the catalog for the variety and the tooling it drove.

### What this actually tells us

This went through more than one round of "that's surprising — is it
real?" before landing here, and the findings changed shape as more
songs and a bug fix came in. Trust the final shape, not an earlier draft
of it (including an earlier draft of this very file):

- **No single model wins at everything, and averaging across songs
  changed the conclusion, not just the margin.** Looking at vocals in
  isolation on the first 3 songs, it looked like "always use the
  dedicated vocal model, Demucs's bundled vocals output is worse." The
  4-song average is messier and more interesting:
  - **Vocals**: Roformer wins on average (5.28dB), but **Kim_Vocal_2 — a
    second dedicated vocal model — actually comes in *last*** (2.96dB,
    behind both Demucs variants). "Use a dedicated vocal model" isn't
    enough of a rule; which one matters as much as whether.
  - **Instrumental**: Kim_Vocal_2 wins on average (10.69dB vs. Roformer's
    10.26dB) — the same model that's worst at isolating pure vocals is
    *best* at isolating everything-but-vocals. A model's SDR on one
    output doesn't predict its SDR on the other.
  - **Drums/bass/other**: only the Demucs variants were tested here. The
    base `htdemucs.yaml` beats the fine-tuned `htdemucs_ft.yaml` on
    average for drums (7.98 vs 7.81dB) and other (2.11 vs 1.77dB);
    `htdemucs_ft` wins bass, but narrowly (4.06 vs 3.87dB). Fine-tuning
    helps vocals a bit more clearly (3.26 vs 3.01dB average) but is a
    wash-to-slightly-worse everywhere else. At ~4x the runtime cost,
    that's not a clearly-justified default if drums/bass/other matter
    more to you than vocals.
- **Discipline (the one song with a real, independently-mastered
  commercial mixdown, not a synthetic sum) is hard for every model** —
  negative SDR on vocals for all four. That's a real, confirmed signal
  (verified with correctly-signed synthetic data in `smoke_test.py`), not
  a scoring bug: dense, synth-heavy industrial production seems to be a
  genuinely harder separation problem than anything else in this catalog,
  across every architecture tested so far.
- **A real bug was found and fixed mid-shootout, and it's worth knowing
  the shape of it**: `Kim_Vocal_2.onnx`'s own filename contains "vocal",
  which used to make its *instrumental* output also match the "vocals"
  canonicalization pattern — both outputs raced to become `vocals.wav`,
  and one silently overwrote the other. The first run's numbers looked
  completely plausible and would have been reported as real findings.
  Caught by checking, not by anything looking obviously wrong. Fixed in
  `separate.py`, with a permanent regression test in `smoke_test.py`.
- **A second real issue, not a bug**: Bon Iver's Perth stems produced
  plausible-looking SDR numbers for every model that turned out to be
  meaningless — the raw tracks simply weren't exported at mix-faithful
  gain levels (bass alone summed to 195% of the mixdown's RMS). Nothing
  in the scoring pipeline could have caught this by erroring; it needed
  a dedicated sanity check (`gain_staging_ratio`), which now runs
  automatically on every song and flags anything outside a plausible
  range — including automatically excluding it from
  `aggregate_results.py`'s averages.

**Practical takeaway for the rest of the project**: pick per-stem, not
per-song-vibes, and re-check this conclusion once more songs are added —
a 4-song sample (3 reliable) is enough to overturn a 3-song conclusion
once already; it can again. For now: Roformer for vocal isolation/
replacement, Kim_Vocal_2 for instrumental-only needs (karaoke-style
backing tracks), Demucs for the full 4-stem split with `htdemucs` (the
cheaper one) as the default rather than `htdemucs_ft` — its extra cost
isn't earning its keep on this evidence.

## The song catalog (`data/songs/`)

| slug | artist / song | why it's useful |
|---|---|---|
| `discipline` | Nine Inch Nails — "Discipline" (*The Slip*) | CC BY-NC-SA — **both** mixdown and multitracks are the real official files, no synthetic mixdown needed. Industrial/alt-rock, baritone lead + **2 separate harmony layers** (BV, Woo Voc), lots of synth/electronic "other" content (Marimba, Piano, Riff, Tone, Vostok Bass/Riff, Xpander). |
| `nude` | Radiohead — "Nude" (*In Rainbows*) | 5 cleanly-labeled official stems (Bass/Drum/Guitar/String FX/Voice) from a 2008 remix contest, already public on archive.org: [`nudestems`](https://archive.org/details/nudestems). Single falsetto lead vocal, sparse/atmospheric — a very different mix density than the other songs. |
| `a_light_that_never_comes` | Linkin Park & Steve Aoki | 8 cleanly-labeled official stems including **separate Lead_Vocals + BG_Vocals** — the clearest harmony-vocal test case in the set. EDM/rock hybrid with a programmed "Effects" layer. Stems: [`linkin-park-a-light-that-never-comes-remix-stems`](https://archive.org/details/linkin-park-a-light-that-never-comes-remix-stems) on archive.org. |

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
[`bon-iver-bon-iver-full-album-stems`](https://archive.org/details/bon-iver-bon-iver-full-album-stems), one ~2GB zip for the whole album,
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
- **Why match only the parenthesized stem label, not the whole output
  filename?** audio-separator names output `<input>_(<StemLabel>)_<model>.<ext>`.
  Matching the whole filename is a real bug that bit this project:
  `Kim_Vocal_2.onnx`'s own model name contains "vocal", so its
  instrumental output also matched the "vocals" pattern and silently
  overwrote the real vocals file — caught by checking the manifest, not
  by anything erroring. `scripts/separate.py`'s `canonicalize()` now
  matches only the label, and `canonicalize_outputs()` hard-fails if two
  outputs ever collide on one bucket again instead of silently clobbering.
- **Why check a gain-staging ratio at all?** Summing raw multitrack files
  only reconstructs something mix-like if those files were exported at
  levels that reflect their real contribution to the mix. Bon Iver's
  "Perth" stems weren't — every bucket's raw sum was wildly out of
  proportion to the real mixdown (bass alone hit 195% of its RMS) — and
  every model still produced plausible-looking SDR numbers against that
  reference, which were actually meaningless. `common.py`'s
  `gain_staging_ratio` catches this automatically now, and
  `aggregate_results.py` excludes a song that fails it from its averages.

## Utility scripts for adding new songs

Beyond the core pipeline, a few scripts exist specifically to lower the
friction of adding more songs — see [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
for the full step-by-step, this is just a map:

- **`scripts/zip_range_extract.py`** — pulls specific files out of a huge
  remote ZIP (e.g. a whole-album stems release) via HTTP range requests,
  without downloading the rest. Used to pull one song's stems out of Bon
  Iver's ~2GB full-album zip for ~87% less bandwidth.
- **`scripts/classify_tracks.py`** — fast signal-processing heuristics
  (percussive ratio, low-frequency energy, pitch) to draft a
  `reference_mapping.json` for a song whose track filenames are
  deliberately obfuscated. Works reasonably for drums/bass; **cannot
  reliably tell vocals apart from other melodic instruments** — verified
  this the hard way on real data (see below).
- **`scripts/ml_vocal_check.py`** — the fix for that gap: runs each
  candidate track through an actual vocal-isolation model and measures
  how much energy routes to its vocals output, rather than guessing from
  pitch alone. Slower (~4min/track on CPU) but the right tool for a
  distinction a pitch heuristic genuinely can't make.
- **`scripts/aggregate_results.py`** — rebuilds `LEADERBOARD.md` (cross-
  song, cross-model) from every song's `results.json`.
