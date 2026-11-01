"""Downloads a YouTube video and extracts its audio for stem separation.

Two separate command-line tools, each doing the one thing it's built for:
yt-dlp fetches the video, ffmpeg pulls the audio out of it. yt-dlp's own
--extract-audio could do both in one step, but keeping the original video
file around (not just the audio) is deliberate — see HANDOFF.md.

yt-dlp breaks against YouTube's changing site code often enough that a
stale pinned version is a real, recurring failure mode in this community
(see its own README). ensure_ytdlp_updated() runs a real `pip install
--upgrade` before every single download attempt, not just once at
install time, for that reason.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

# YouTube increasingly requires running a small JS "challenge" to unlock all
# formats (see yt-dlp's EJS wiki page). node is already installed on this
# machine (via nvm) for other tools, so point yt-dlp at it instead of adding
# deno as a second JS runtime dependency; ejs:github is yt-dlp's own official
# remote component that does the actual challenge-solving, fetched from their
# GitHub releases (not a third-party script).
_node = shutil.which("node")
_YTDLP_COMMON_ARGS = ["--no-playlist"]
if _node:
    _YTDLP_COMMON_ARGS += ["--js-runtimes", f"node:{Path(_node).parent}", "--remote-components", "ejs:github"]

# yt-dlp's progress line, e.g. "[download]  45.2% of  123.45MiB at 3.21MiB/s ETA 00:12"
_YTDLP_PROGRESS_RE = re.compile(r"\[download\]\s+([\d.]+)% of\s+([\d.]+\w+ib)(?:\s+at\s+([\d.]+\w+ib/s))?.*?ETA\s+(\S+)", re.IGNORECASE)
# ffmpeg's own progress line, e.g. "time=00:01:23.45 bitrate=..."
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):([\d.]+)")


def ensure_ytdlp_updated(on_progress: Callable[[str], None] = lambda s: None) -> None:
    on_progress("Updating yt-dlp…")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--upgrade", "--quiet", "yt-dlp"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Couldn't update yt-dlp: {result.stderr.strip()[:500]}")


def fetch_metadata(url: str) -> dict:
    """Title/duration only, no download — lets the UI show something before
    the real (slow) download starts, and lets extract_audio() compute a
    percentage from ffmpeg's `time=` output."""
    result = subprocess.run(
        ["yt-dlp", *_YTDLP_COMMON_ARGS, "--dump-json", "--no-download", url],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Couldn't read that URL: {result.stderr.strip()[:500]}")
    data = json.loads(result.stdout)
    return {"title": data.get("title") or url, "duration_seconds": data.get("duration")}


def download_video(url: str, dest_dir: Path, on_progress: Callable[[str], None] = lambda s: None) -> Path:
    """Downloads the best available video+audio into dest_dir/video.<ext>
    and returns the path actually written (yt-dlp picks the extension)."""
    out_template = str(dest_dir / "video.%(ext)s")
    cmd = ["yt-dlp", *_YTDLP_COMMON_ARGS, "--newline", "-o", out_template, url]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    recent_lines: list[str] = []
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        match = _YTDLP_PROGRESS_RE.search(line)
        if match:
            pct, size, speed, eta = match.groups()
            on_progress(f"Downloading video: {pct}% of {size}" + (f" at {speed}" if speed else "") + f", ETA {eta}")
        else:
            recent_lines.append(line)
            recent_lines[:] = recent_lines[-8:]
    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"yt-dlp failed (exit code {process.returncode}). Last output: " + " | ".join(recent_lines))

    produced = sorted(dest_dir.glob("video.*"))
    if not produced:
        raise RuntimeError("yt-dlp reported success but wrote no video file")
    return produced[0]


def extract_audio(
    video_path: Path, dest_path: Path, duration_seconds: float | None = None,
    on_progress: Callable[[str], None] = lambda s: None,
) -> None:
    """Strips the audio track out to a clean 44.1kHz stereo WAV — the same
    format uploaded songs arrive in, so separate_upload() needs no changes."""
    cmd = ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ar", "44100", "-ac", "2", str(dest_path)]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    recent_lines: list[str] = []
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        match = _FFMPEG_TIME_RE.search(line)
        if match and duration_seconds:
            h, m, s = match.groups()
            elapsed = int(h) * 3600 + int(m) * 60 + float(s)
            on_progress(f"Extracting audio: {min(100, round(100 * elapsed / duration_seconds))}%")
        else:
            recent_lines.append(line)
            recent_lines[:] = recent_lines[-8:]
    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit code {process.returncode}). Last output: " + " | ".join(recent_lines))
    if not dest_path.exists():
        raise RuntimeError("ffmpeg reported success but wrote no audio file")
