#!/usr/bin/env python3
"""
vps-make-4ch-karaoke.py
Batch utility for Azure VPS to generate single-stream 4-channel Karaoke MP4s.

Channels layout in output MP4:
  - Channels 1 & 2 (FL, FR): Demucs AI Clean Instrumental (no_vocals)
  - Channels 3 & 4 (BL, BR): Demucs AI Lead Vocals (vocals)

Video stream is copied (-c:v copy) without re-encoding to preserve 100% video
quality in seconds.

Usage:
  # Process a single song by id or json path:
  ~/karaoke_env/bin/python3 scripts/vps-make-4ch-karaoke.py ic3peak-boo-hoo

  # Process all songs in manifest:
  ~/karaoke_env/bin/python3 scripts/vps-make-4ch-karaoke.py --all
"""

import os
import sys
import json
import glob
import urllib.parse
import subprocess
import tempfile
import argparse

STEM_CACHE_ROOT = os.path.expanduser("~/.cache/karaoke_stems")
OUTPUT_DIR = os.path.expanduser("~/karaoke_work/4ch_videos")
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "../src/data/songs-manifest.json")
CDN_BASE = "https://cdn.sudothy.me"


def run_cmd(cmd, desc=None):
    if desc:
        print(f"[*] {desc}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[!] Error running {' '.join(cmd[:4])}...:\n{res.stderr[:400]}", file=sys.stderr)
        return False
    return True


def ensure_stems(song_slug: str, video_file: str, temp_dir: str) -> tuple[str, str]:
    """
    Ensures both vocals.wav and no_vocals.wav exist for this song.
    Reuses ~/.cache/karaoke_stems/<slug>/ if available.
    """
    song_stem_dir = os.path.join(STEM_CACHE_ROOT, song_slug)
    os.makedirs(song_stem_dir, exist_ok=True)
    cached_vocals = os.path.join(song_stem_dir, "vocals.wav")
    cached_no_vocals = os.path.join(song_stem_dir, "no_vocals.wav")

    if os.path.exists(cached_vocals) and os.path.exists(cached_no_vocals):
        print(f"[*] Found existing Demucs stems in cache: {song_stem_dir}")
        return cached_vocals, cached_no_vocals

    # Fetch original audio from CDN if not already local
    input_wav = os.path.join(temp_dir, f"{song_slug}_source.wav")
    video_url = f"{CDN_BASE}/{urllib.parse.quote(video_file)}"
    print(f"[*] Downloading audio from CDN: {video_url}")
    dl_cmd = [
        "ffmpeg", "-y",
        "-i", video_url,
        "-vn",
        "-ac", "2",
        "-ar", "44100",
        "-c:a", "pcm_s16le",
        input_wav
    ]
    if not run_cmd(dl_cmd, "Extracting lossless stereo audio stream"):
        return "", ""

    # Run Demucs with --two-stems vocals
    demucs_out = os.path.join(temp_dir, "demucs")
    demucs_cmd = [
        sys.executable, "-m", "demucs.separate",
        "--two-stems", "vocals",
        "-n", "htdemucs",
        "-o", demucs_out,
        input_wav
    ]
    print("[*] Running Meta Demucs neural vocal separation (one-time job)...")
    if not run_cmd(demucs_cmd):
        return "", ""

    # Locate generated stems
    found_vocals = glob.glob(os.path.join(demucs_out, "htdemucs", "*", "vocals.wav"))
    found_no_vocals = glob.glob(os.path.join(demucs_out, "htdemucs", "*", "no_vocals.wav"))

    if not found_vocals or not found_no_vocals:
        print("[!] Failed to locate Demucs output stems", file=sys.stderr)
        return "", ""

    # Cache stems
    subprocess.run(["cp", found_vocals[0], cached_vocals], check=True)
    subprocess.run(["cp", found_no_vocals[0], cached_no_vocals], check=True)
    print(f"[✓] Cached Demucs stems at: {song_stem_dir}")

    return cached_vocals, cached_no_vocals


def build_4ch_mp4(video_file: str, vocals_wav: str, no_vocals_wav: str, output_mp4: str) -> bool:
    """
    Combines video with 4-channel audio:
      Ch 1-2: no_vocals.wav
      Ch 3-4: vocals.wav
    Copies video stream (-c:v copy) for instant lossless muxing.
    """
    video_url = f"{CDN_BASE}/{urllib.parse.quote(video_file)}"
    os.makedirs(os.path.dirname(output_mp4), exist_ok=True)

    print(f"[*] Muxing into 4-channel single-stream MP4 -> {output_mp4}")
    mux_cmd = [
        "ffmpeg", "-y",
        "-i", video_url,
        "-i", no_vocals_wav,
        "-i", vocals_wav,
        "-filter_complex", "[1:a][2:a]amerge=inputs=2[aout]",
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "320k",
        "-movflags", "+faststart",
        output_mp4
    ]
    return run_cmd(mux_cmd, "Muxing 4-channel MP4")


def process_song(song: dict, temp_dir: str):
    slug = song.get("id")
    video_file = song.get("videoFile")
    title = song.get("title", slug)

    print(f"\n=======================================================")
    print(f"[*] Processing: {title} ({slug})")
    print(f"[*] Video File: {video_file}")
    print(f"=======================================================")

    vocals_wav, no_vocals_wav = ensure_stems(slug, video_file, temp_dir)
    if not vocals_wav or not no_vocals_wav:
        print(f"[!] Skipping {slug} due to stem separation error.")
        return False

    out_mp4 = os.path.join(OUTPUT_DIR, video_file)
    success = build_4ch_mp4(video_file, vocals_wav, no_vocals_wav, out_mp4)
    if success:
        print(f"[🎉] Successfully generated 4-channel video: {out_mp4}")
        return True
    return False


def main():
    parser = argparse.ArgumentParser(description="Generate 4-channel single-stream Karaoke MP4s")
    parser.add_argument("target", nargs="?", help="Song ID or slug to process")
    parser.add_argument("--all", action="store_true", help="Process all songs in manifest")
    args = parser.parse_args()

    if not args.target and not args.all:
        parser.print_help()
        sys.exit(1)

    if not os.path.exists(MANIFEST_PATH):
        print(f"[!] Manifest not found at: {MANIFEST_PATH}")
        sys.exit(1)

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        songs = json.load(f)

    if args.target:
        matches = [s for s in songs if s.get("id") == args.target or args.target in s.get("videoFile", "")]
        if not matches:
            print(f"[!] Song '{args.target}' not found in manifest.")
            sys.exit(1)
        target_songs = matches
    else:
        target_songs = songs

    print(f"[*] Found {len(target_songs)} track(s) to process.")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir:
        for song in target_songs:
            try:
                process_song(song, temp_dir)
            except Exception as e:
                print(f"[!] Failed to process {song.get('id')}: {e}", file=sys.stderr)

    print(f"\n[✓] All jobs completed! 4-channel MP4s saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
