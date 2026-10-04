"""Extract specific files from a remote ZIP without downloading the whole thing.

Several official stem releases (e.g. Bon Iver's full-album stems on
archive.org) are a single multi-gigabyte ZIP for an entire album when you
only want one song. ZIP's central directory lives at the end of the file
and lists every entry's offset and compressed size, so this fetches just
that directory via an HTTP Range request, then range-fetches and inflates
only the entries you actually asked for.

Usage:
    python zip_range_extract.py <url> <substring> <output_dir>

Downloads only the entries whose path contains <substring> (case-insensitive).
"""
from __future__ import annotations

import struct
import sys
import urllib.request
import zlib
from pathlib import Path

EOCD_SIG = b"PK\x05\x06"
CENTRAL_DIR_SIG = b"PK\x01\x02"


# Some archive.org CDN nodes 500 on urllib's default "Python-urllib/x.y"
# User-Agent (presumably naive bot-blocking) but are fine with curl's or a
# browser's — so set one explicitly rather than looking like a bare script.
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; musicmod-zip-range-extract/1.0)"}


def http_get(url: str, start: int | None = None, end: int | None = None) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    if start is not None:
        req.add_header("Range", f"bytes={start}-{end}")
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def get_size(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD", headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        return int(resp.headers["Content-Length"])


def parse_central_directory(url: str, total_size: int) -> list[dict]:
    tail = http_get(url, max(0, total_size - 2_000_000), total_size - 1)
    tail_start = total_size - len(tail)
    eocd_idx = tail.rfind(EOCD_SIG)
    if eocd_idx == -1:
        raise RuntimeError("EOCD not found in last 2MB — zip has an unusually large comment field")

    _, _, _, _, n_entries, cd_size, cd_offset, _ = struct.unpack(
        "<IHHHHIIH", tail[eocd_idx: eocd_idx + 22]
    )

    cd_start_in_tail = cd_offset - tail_start
    if cd_start_in_tail < 0:
        cd_buf = http_get(url, cd_offset, cd_offset + cd_size - 1)
    else:
        cd_buf = tail[cd_start_in_tail: cd_start_in_tail + cd_size]

    entries = []
    pos = 0
    while pos < len(cd_buf) and cd_buf[pos: pos + 4] == CENTRAL_DIR_SIG:
        hdr = cd_buf[pos: pos + 46]
        (_, _, _, _, method, _, _, _, csize, usize, fname_len, extra_len,
         comment_len, _, _, _, local_offset) = struct.unpack("<IHHHHHHIIIHHHHHII", hdr)
        fname = cd_buf[pos + 46: pos + 46 + fname_len].decode("utf-8", "replace")
        entries.append({"name": fname, "method": method, "csize": csize,
                         "usize": usize, "offset": local_offset})
        pos += 46 + fname_len + extra_len + comment_len

    if len(entries) != n_entries:
        print(f"[zip_range_extract] WARNING: parsed {len(entries)} entries, "
              f"EOCD says {n_entries} — zip64 or a parsing edge case?", file=sys.stderr)
    return entries


def extract_entry(url: str, entry: dict, out_path: Path) -> None:
    # Local header is 30 bytes fixed + filename + extra field, of unknown
    # exact length until we've actually read it — fetch generously, then
    # re-fetch if the margin wasn't enough.
    margin = 256
    while True:
        chunk = http_get(url, entry["offset"],
                          entry["offset"] + 30 + len(entry["name"]) + margin + entry["csize"])
        fname_len, extra_len = struct.unpack("<HH", chunk[26:30])
        data_start = 30 + fname_len + extra_len
        if data_start + entry["csize"] <= len(chunk):
            break
        margin *= 4  # extra field was bigger than expected; widen and retry

    compressed = chunk[data_start: data_start + entry["csize"]]
    if entry["method"] == 0:
        data = compressed
    elif entry["method"] == 8:
        data = zlib.decompressobj(-15).decompress(compressed)
    else:
        raise RuntimeError(f"Unsupported zip compression method {entry['method']} for {entry['name']}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    print(f"[zip_range_extract] wrote {out_path} ({len(data)} bytes)", file=sys.stderr)


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    url, substring, out_dir = sys.argv[1], sys.argv[2].lower(), Path(sys.argv[3])

    total_size = get_size(url)
    print(f"[zip_range_extract] remote zip is {total_size / 1e6:.1f} MB — "
          f"fetching only the central directory first", file=sys.stderr)
    entries = parse_central_directory(url, total_size)

    matches = [e for e in entries if substring in e["name"].lower() and not e["name"].endswith("/")]
    if not matches:
        sys.exit(f"No entries matched {substring!r} among {len(entries)} files in the archive")

    total_bytes = sum(e["csize"] for e in matches)
    print(f"[zip_range_extract] {len(matches)} matching file(s), "
          f"{total_bytes / 1e6:.1f} MB to fetch (vs {total_size / 1e6:.1f} MB for the whole archive)",
          file=sys.stderr)

    for entry in matches:
        rel_name = Path(entry["name"]).name
        extract_entry(url, entry, out_dir / rel_name)


if __name__ == "__main__":
    main()
