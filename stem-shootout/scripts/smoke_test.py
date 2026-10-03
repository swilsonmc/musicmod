"""Synthetic smoke test for the shootout harness — no real audio required.

Builds fake vocals/drums/bass/other stems, sums them into a fake mixdown and
a fake multitrack reference with a deliberate offset + silence trim, runs
them through bus_reference -> align -> score, and checks that: (a) the
measured alignment offset matches what we injected, and (b) a "perfect"
estimate scores a high SDR while a noisy one scores lower. This exists only
to validate the pipeline's own logic — delete it once real NIN audio is in use.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import apply_offset, best_offset, load_audio, save_audio  # noqa: E402
from score import build_reference_set, score_model  # noqa: E402

SR = 44100
DUR = 6
TMP = Path(__file__).parent.parent / "data" / "_smoke_test"


def make_stem(freq: float, seed: int) -> np.ndarray:
    """A sine pad plus sparse noise transients.

    A pure sustained tone is a bad cross-correlation test signal: it's
    periodic, so correlation has many near-equal peaks and alignment can
    lock onto the wrong one (exactly the failure mode a first version of
    this test caught). Real audio has transients — drum hits, consonants —
    that anchor a correlation to a single unambiguous peak, so the smoke
    test needs them too to actually exercise the alignment code honestly.
    """
    rng = np.random.default_rng(seed)
    t = np.arange(SR * DUR) / SR
    tone = 0.1 * np.sin(2 * np.pi * freq * t)
    mono = tone + 0.01 * rng.standard_normal(SR * DUR)
    n_hits = 8
    hit_centers = rng.choice(SR * DUR - 2000, size=n_hits, replace=False)
    for c in hit_centers:
        burst_len = 800
        envelope = np.exp(-np.arange(burst_len) / 120)
        mono[c: c + burst_len] += 0.6 * envelope * rng.standard_normal(burst_len)
    return np.stack([mono, mono], axis=1).astype("float32")


def main() -> None:
    if TMP.exists():
        shutil.rmtree(TMP)
    raw_dir = TMP / "raw"
    mapping_path = TMP / "mapping.json"
    reference_dir = TMP / "reference_bucketed"
    aligned_dir = TMP / "reference_aligned"
    estimates_dir = TMP / "estimates" / "fake_model"

    stems = {
        "vocals": make_stem(440, 1),
        "drums": make_stem(110, 2),
        "bass": make_stem(55, 3),
        "other": make_stem(660, 4),
    }
    for name, data in stems.items():
        save_audio(raw_dir / f"{name}.wav", data)
    mapping_path.write_text(json.dumps({k: [f"{k}.wav"] for k in stems}))

    full_mix = sum(stems.values())
    injected_offset = int(0.37 * SR)
    mixdown = apply_offset(full_mix, -injected_offset)  # mixdown "starts later" than the multitrack
    save_audio(TMP / "mixdown.wav", mixdown)

    sys.argv = ["bus_reference.py", "--raw-dir", str(raw_dir), "--mapping", str(mapping_path),
                "--output-dir", str(reference_dir)]
    from bus_reference import main as bus_main
    bus_main()

    measured_offset = best_offset(reference=load_audio(TMP / "mixdown.wav"),
                                   target=load_audio(reference_dir / "full_mix.wav"))
    # mixdown was built by delaying full_mix, i.e. full_mix (the target) LEADS
    # mixdown (the reference) — so the expected signed offset is negative.
    expected_offset = -injected_offset
    print(f"[smoke] injected offset={injected_offset}, expected measured={expected_offset}, "
          f"actual measured={measured_offset}")
    assert abs(measured_offset - expected_offset) <= 2, "alignment is off by more than 2 samples"

    for bucket in ("vocals", "drums", "bass", "other"):
        aligned = apply_offset(load_audio(reference_dir / f"{bucket}.wav"), measured_offset)
        save_audio(aligned_dir / f"{bucket}.wav", aligned)

    rng = np.random.default_rng(99)
    manifest = {}
    for bucket, data in stems.items():
        shifted = apply_offset(data, -injected_offset)
        noisy = shifted + 0.5 * rng.standard_normal(shifted.shape).astype("float32")
        save_audio(estimates_dir / f"{bucket}.wav", noisy)
        manifest[bucket] = str((estimates_dir / f"{bucket}.wav").relative_to(TMP / "estimates"))
    (estimates_dir / "manifest.json").write_text(json.dumps(manifest))

    refs = build_reference_set(aligned_dir)
    result = score_model(manifest, estimates_dir, refs)
    print("[smoke] noisy-estimate scores:", json.dumps(result, indent=2))
    assert all(v["SDR"] < 10 for v in result["stems"].values()), \
        "expected a noisy estimate to score a modest SDR, not something inflated"

    manifest_perfect = {}
    for bucket, data in stems.items():
        shifted = apply_offset(data, -injected_offset)
        save_audio(estimates_dir / f"{bucket}_perfect.wav", shifted)
        manifest_perfect[bucket] = str((estimates_dir / f"{bucket}_perfect.wav").relative_to(TMP / "estimates"))
    result_perfect = score_model(manifest_perfect, estimates_dir, refs)
    print("[smoke] perfect-estimate scores:", json.dumps(result_perfect, indent=2))
    assert all(v["SDR"] > 15 for v in result_perfect["stems"].values()), \
        "expected a perfect estimate to score a very high SDR"

    shutil.rmtree(TMP)
    print("[smoke] PASSED — alignment + scoring pipeline behaves correctly on synthetic data")


if __name__ == "__main__":
    main()
