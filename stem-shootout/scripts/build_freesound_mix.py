"""Build a ground-truth test song from isolated Freesound recordings.

Reads `freesound_recipe.json` in a song folder, downloads each listed
sound's public high-quality preview (no account needed; the original
files require OAuth), trims all of them to the same length, and writes:

  reference_raw/<file>   each isolated source, exactly as it sits in the mix
  mixdown.wav            their sum

Every source is scaled by the same factor as the mix, so the references
add up to the mixdown exactly and bus_reference.py's gain-staging check
passes by construction. The previews are lossy MP3s, but the mix is built
from the same decoded audio as the references, so the scoring stays fair.

Two kinds of recipe. Unrelated solo recordings ("level_sources": true, the
default) are evened out to equal loudness first, the "random mix" test
used in the separation literature. A real song's stems (a "song
construction kit", "level_sources": false) keep the producer's own
balance, because that balance is what makes a real mix hard.

Freesound's "solo" tag isn't reliable: check each sound's description
before adding it to a recipe (some "solo" clips are full band recordings,
MIDI renders, or AI-generated).

Usage: python build_freesound_mix.py --song-dir ../data/songs/<slug>
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf


SR = 44100
UA = {"User-Agent": "Mozilla/5.0 (musicmod stem-shootout)"}


def preview_url(sound_id: int) -> str:
    req = urllib.request.Request(f"https://freesound.org/s/{sound_id}/", headers=UA)
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    match = re.search(r"https://cdn\.freesound\.org/previews/[^\"']+-hq\.mp3", page)
    if not match:
        sys.exit(f"No HQ preview found on the page for sound {sound_id}")
    return match.group(0)


def fetch_decoded(sound_id: int, cache_dir: Path) -> np.ndarray:
    mp3 = cache_dir / f"{sound_id}.mp3"
    if not mp3.exists():
        req = urllib.request.Request(preview_url(sound_id), headers=UA)
        mp3.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    wav = cache_dir / f"{sound_id}.wav"
    if not wav.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3),
                        "-ar", str(SR), "-ac", "2", str(wav)], check=True)
    audio, _ = sf.read(wav, dtype="float64")
    return audio


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--song-dir", required=True, type=Path)
    args = ap.parse_args()

    recipe = json.loads((args.song_dir / "freesound_recipe.json").read_text())
    cache_dir = args.song_dir / "freesound_cache"
    raw_dir = args.song_dir / "reference_raw"
    cache_dir.mkdir(exist_ok=True)
    raw_dir.mkdir(exist_ok=True)

    sources = []
    for src in recipe["sources"]:
        audio = fetch_decoded(src["id"], cache_dir)
        start = int(src.get("start_seconds", 0) * SR)
        sources.append((src, audio[start:]))

    shortest = min(len(a) for _, a in sources) / SR
    length = int(min(recipe.get("seconds", shortest), shortest) * SR)
    if length < 10 * SR:
        sys.exit(f"Only {length / SR:.1f}s of overlap — pick longer sounds or a smaller start_seconds")

    leveled = []
    for src, audio in sources:
        clip = audio[:length]
        rms = float(np.sqrt(np.mean(clip ** 2)))
        if rms == 0:
            sys.exit(f"Sound {src['id']} is silent in the chosen window")
        gain = (0.1 / rms) if recipe.get("level_sources", True) else 1.0
        leveled.append((src, clip * gain))

    mix = sum(clip for _, clip in leveled)
    scale = 0.98 / float(np.abs(mix).max())
    for src, clip in leveled:
        sf.write(raw_dir / src["file"], (clip * scale).astype("float32"), SR, subtype="FLOAT")
    sf.write(args.song_dir / "mixdown.wav", (mix * scale).astype("float32"), SR, subtype="FLOAT")
    print(f"[freesound] {args.song_dir.name}: {len(leveled)} sources, {length / SR:.1f}s, "
          f"wrote mixdown.wav + reference_raw/", file=sys.stderr)


if __name__ == "__main__":
    main()
