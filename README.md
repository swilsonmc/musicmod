# musicmod

A locally-hosted web app for taking apart and rebuilding a song: AI stem
separation, editable MIDI transcription per stem, swapping instruments or
vocals, and a non-linear-editor-style multitrack timeline — built to run
on your own machine, not a cloud service.

**Status: early — Phase 1 of 6.** Nothing playable exists yet. Right now
this repo holds the harness for picking which AI separation model to
build everything else on top of, validated against real official
multitrack recordings rather than guesswork.

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

## What's here now: the stem-separation model shootout

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
for the full writeup of each):

- **Nine Inch Nails — "Discipline"** (*The Slip*, CC-licensed) — real
  official mixdown *and* real official multitrack stems, including 2
  separate vocal harmony layers.
- **Radiohead — "Nude"** (*In Rainbows*) — 5 official remix-contest stems,
  solo falsetto vocal.
- **Linkin Park & Steve Aoki — "A Light That Never Comes"** — 8 official
  stems with separate lead and backing vocal tracks, the clearest
  vocal-harmony test case in the set.

Test audio is downloaded locally and never committed to this repo (see
`.gitignore`) — some of it is ordinary copyrighted commercial material
whose *stems* happen to have been officially released for remixing, which
doesn't make it redistributable. Only the harness code and each song's
small `config.json`/`reference_mapping.json` are tracked in git.

## Repo layout

```
HANDOFF.md               full project vision, architecture decisions, and status log
CONTRIBUTING.md          how to add a new song to the shootout, and general workflow
LICENSE                  MIT, for the code in this repo — not for any third-party test audio
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
