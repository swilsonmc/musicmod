# Stem-separation model shootout

Phase 1 of the musicmod project: before building anything else, figure out
which AI stem-separation model to standardize on, using real ground truth
instead of a vibe check.

## The idea

Nine Inch Nails released both the official final mixdown *and* the raw
multitrack stems for every song on *The Slip* (free, CC-licensed, via the
now-archived remix.nin.com) and for four songs on *Ghosts I–IV*. That's a
rare case of having real ground-truth separated audio for a commercially
produced song. The plan:

1. Take the official stereo mixdown of one song.
2. Run it through several AI separation models (Demucs, MDX-Net,
   BS-Roformer/Mel-Band-Roformer, etc. via `audio-separator`).
3. Bus the *real* multitrack stems down into the same 4 canonical buckets
   (vocals/drums/bass/other) the AI models produce.
4. Score each model's output against that real ground truth with
   `museval` (the SDR/ISR/SIR/SAR metric used in the SiSEC/MDX separation
   challenges) — a number, not an impression.

*Ghosts I–IV* is fully instrumental, so it's only useful for
drums/bass/other, not vocals — pick a track from *The Slip* for the full
4-stem test.

## Status

The harness (this folder) is built and validated against synthetic data
(`scripts/smoke_test.py`). It has **not** run against real NIN audio yet —
this cloud session's network policy blocks `archive.org` and the fan-site
mirrors that host the files. See `HANDOFF.md` at the repo root for how to
unblock that, or just hand this folder to a local session that has normal
internet access.

## Setup

```bash
pip install -r requirements.txt
audio-separator --list_models     # see current exact model identifiers —
                                   # don't trust names in config.example.json blindly
```

## Getting the reference files

1. Pick a song from *The Slip* (needs vocals+drums+bass+other, not an
   instrumental-only track).
2. Download its official stereo mixdown → `data/mixdown.wav`.
3. Download its official raw multitrack stems → `data/reference_raw/`.
4. Write `data/reference_mapping.json`, mapping each raw track filename to
   one of the 4 canonical buckets (see the docstring in
   `scripts/bus_reference.py` for the exact format — e.g. "Kick.wav" and
   "Snare.wav" both go under `"drums"`).
5. Copy `config.example.json` to `config.json` and fill in the song name,
   paths, and the model list (from `--list_models` above).

All WAVs must be 44.1kHz (resample first if not — see `common.py`'s
`load_audio` docstring for why that's not done automatically inside
scoring).

## Running it

```bash
python scripts/run_shootout.py
```

This separates the mixdown with every configured model, aligns the real
multitrack reference to the mixdown's timeline (cross-correlation — a
printed offset lets you sanity-check it worked), scores each model, and
writes `data/results.md` (a leaderboard) and `data/results.json` (full
SDR/ISR/SIR/SAR breakdown per model per stem).

## Design notes

- **Why bus the reference down instead of scoring raw tracks directly?**
  AI models produce exactly 4 buckets (or sometimes 2: vocals +
  instrumental). The real multitracks have dozens of per-instrument
  tracks. Comparing fairly means summing the real tracks into the same 4
  buckets first.
- **Why align at all?** The official mixdown and the raw multitrack
  session don't necessarily share the same head/tail silence. Getting
  this wrong silently tanks every model's score by the same amount, which
  would make the whole comparison meaningless — hence the printed offset
  and a sanity-check warning if it looks implausibly large.
- **Why evaluate all of a model's stems together, not one at a time?**
  `museval`'s SIR (how much of one source leaks into another's estimate)
  is only meaningful when it sees every true source at once. Scoring stems
  one at a time throws that signal away — see `scripts/score.py`'s
  docstring.
- **2-stem models** (vocals + instrumental only, e.g. dedicated vocal
  isolators) are scored against vocals + a derived "instrumental"
  reference (drums+bass+other summed), not against all 4 buckets
  individually — they never claimed to split those apart.
