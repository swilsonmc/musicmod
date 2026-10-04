# Contributing

This covers the recurring, mechanical parts of working on this repo —
written for whoever (human or AI agent) picks this up next. For the
project's vision, architecture decisions, and current status, read
[`HANDOFF.md`](./HANDOFF.md) first; this file is deliberately narrower.

## Adding a new song to the stem-separation shootout

The shootout ([`stem-shootout/`](./stem-shootout/)) is only as useful as
its catalog is varied. If you're adding a song, you need: a real official
mixdown (or a legitimate way to build one), real official per-instrument
multitrack stems, and a license situation you're comfortable with. Here's
the full recipe, written from having done it four times already.

### 1. Find a song with *real* official multitrack stems

Not a leak, not a fan rip — a stem/multitrack release the artist or label
actually put out, usually for a remix contest or (rarely) under a CC
license. These are rarer than you'd think but not as rare as you'd fear.
What's worked so far:

- **Search archive.org directly**, not just the general web — many remix-
  contest stem sets from the 2000s–2010s (remix.nin.com, Indaba Music,
  acidplanet.com, etc.) were archived there after the original sites shut
  down, and the general web barely indexes them. Use the advanced search
  API: `https://archive.org/advancedsearch.php?q=<query>&fl[]=identifier&fl[]=title&output=json`
  with `curl`, not just the web UI — much faster to scan.
- **Check `archive.org/metadata/<identifier>`** before committing to
  anything — it lists every file in the item, so you can tell a real
  per-instrument stem set (individual labeled .wav files) apart from a
  DAW-project-only release (Ableton/Pro Tools session files, which need
  that actual DAW to render — much more friction, lower priority) or a
  finished-remixes-only item (not source material at all).
- Known-good sources so far: NIN's catalog (CC-licensed, search
  `"<song> multitracks"` or similar), individual remix-contest stem
  uploads (search `"<artist> <song> stems"`), and Bon Iver's full-album
  Stems Project zip.
- **What didn't pan out** when searched (as of this writing — may have
  changed by the time you read this, so don't take this as permanent): metal
  band official stems (found only paid platforms like Nail The Mix, not
  freely public), hip-hop acapella+instrumental pairs for well-known
  tracks, EDM remix-contest stems (mostly distributed via Splice/Beatport
  rather than mirrored anywhere public). **If you find a clean source for
  any of these, it would genuinely improve the catalog's variety — female
  lead vocalist and rap/spoken-word vocals are both still missing.**

### 2. Figure out the licensing situation, and be honest about it in the config

Two cases, both already in the catalog as examples:

- **CC-licensed** (like NIN's `discipline`): both mixdown and stems are
  freely redistributable. Simplest case.
- **Ordinary commercial release, stems freely given out for remixing**
  (like `nude`, `a_light_that_never_comes`): the stems are legitimately
  public, but there's no license to redistribute an independently-sourced
  master mixdown. Build the mixdown as a **peak-normalized sum of the
  official stems** instead (`common.py`'s `peak_normalize`) — this is not
  a workaround, it's the same methodology the MUSDB18 benchmark itself
  uses. Write this clearly into the song's `license_note` field; don't
  let a future reader assume it's an independently mastered master.

Either way: **never commit the audio itself.** Only the small
`config.json`/`reference_mapping.json` per song go in git (see
`.gitignore`) — the audio stays local to whoever runs the harness.

### 3. If the stems are a giant single archive, don't download the whole thing

Several releases bundle a whole album into one multi-gigabyte zip when
you only want one song (Bon Iver's Stems Project is ~2GB for 10 songs).
Use `scripts/zip_range_extract.py <url> <substring> <output_dir>` — it
fetches only the zip's central directory plus the specific entries you
ask for, via HTTP range requests, without downloading the rest. Saved
~87% of the bandwidth on the Bon Iver extraction (270MB vs. 2080MB).

### 4. Build `reference_mapping.json`

This maps each raw track filename to one of the 4 canonical buckets
(`vocals`/`drums`/`bass`/`other`) — see `scripts/bus_reference.py`'s
docstring for the exact JSON format.

If the track names are self-explanatory ("Lead Vox.wav", "Kick.wav"),
just write the mapping by hand.

**If they're deliberately obfuscated** (Bon Iver's are — place names
instead of instrument names, specifically so remixers had to listen
rather than cherry-pick), don't try to guess from context and don't trust
a cheap pitch-based heuristic blindly:
`scripts/classify_tracks.py` runs fast signal-processing heuristics
(percussive ratio for drums, low-frequency energy for bass) that work
reasonably well — **except for telling vocals apart from any other clean
melodic instrument, which pitch-tracking alone cannot do** (verified the
hard way: it mislabeled 7 of 10 real Bon Iver tracks as vocals). For that
specific distinction, use `scripts/ml_vocal_check.py` instead, which runs
each candidate track through an actual vocal-isolation model and measures
how much energy it routes to the vocals output — a model trained for
exactly that distinction is a far better judge of it than a hand-rolled
heuristic. Both scripts print their reasoning; treat the output as a
draft to sanity-check, not a final answer.

### 5. Write `config.json`

Copy `config.example.json`'s schema. Every path inside it is relative to
the song's own folder (`data/songs/<slug>/`), not the repo root. Run
`audio-separator --list_models` and copy real model identifiers — the
ones already in other songs' configs are a reasonable starting set, but
confirm them against the live list rather than assuming they're still
current.

### 6. Run it

```bash
python scripts/run_shootout.py --config ../data/songs/<slug>/config.json
```

Sanity-check **both** printed numbers before trusting the scores:

- **The alignment offset** can legitimately be tens of seconds (real
  sessions often run longer than the released edit), but if it's wildly
  implausible, something's wrong with the mixdown/multitrack pairing.
- **The gain-staging ratio** (full_mix/mixdown RMS) should land roughly
  in 0.4-2.0. Outside that, the raw tracks probably aren't gain-staged
  consistently with the mixdown — this happened for real with Bon Iver's
  "Perth" (every bucket summed wildly out of proportion to the mixdown,
  bass alone hit 195%) and produced completely plausible-*looking* SDR
  numbers that were actually meaningless. This isn't something alignment
  or scoring can fix; it's a property of how the source release was
  exported. `aggregate_results.py` automatically excludes a song that
  fails this check from its averages — but only once a song's been
  checked once; don't assume a new song is fine just because it runs
  without erroring.

Re-running is cheap: already-separated models are reused automatically
(pass `--force` to redo them).

### 7. Regenerate the cross-song leaderboard

```bash
python scripts/aggregate_results.py
```

This rewrites `LEADERBOARD.md` from every song's `results.json` — rerun
it any time the catalog or model list changes so it doesn't go stale.

## General workflow

- Run `scripts/smoke_test.py` before trusting any change to the alignment
  or scoring logic — it's synthetic (no real audio needed) and exists
  specifically because this harness has already had real, sign-flip and
  path-convention bugs that looked fine until tested against real data.
- Commit small and often. Audio/model files are gitignored by extension
  and by path — if `git status` ever shows a `.wav`/`.flac`/`.onnx`/etc.
  file staged, stop and check `.gitignore` before committing.
- See `HANDOFF.md` for the full project vision and current phase status,
  and for the local-development setup instructions.
