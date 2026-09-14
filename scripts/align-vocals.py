#!/usr/bin/env python3
"""
Vocal Alignment & Cutoff Detection Engine
Uses Meta Demucs (htdemucs) for neural vocal separation and Silero VAD
for millisecond-accurate vocal activity boundary detection.
"""

import os
import sys
import json
import glob
import urllib.parse
import subprocess
import tempfile
import torch
import soundfile as sf
import numpy as np

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

# Ensure model cache directories exist
CACHE_DIR = os.path.expanduser("~/.cache/karaoke_models")
os.makedirs(CACHE_DIR, exist_ok=True)
torch.hub.set_dir(CACHE_DIR)

from silero_vad import load_silero_vad, get_speech_timestamps

print(f"[*] Initializing Torch (Device: {'cuda' if torch.cuda.is_available() else 'cpu'})...")
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Load Silero VAD
print("[*] Loading Silero VAD model...")
vad_model = load_silero_vad()
vad_model.to(device)
print("[✓] Silero VAD ready.")


def download_audio(video_file: str, out_wav: str) -> bool:
    """Streams audio from CDN directly via ffmpeg into 16kHz mono WAV."""
    url = f"https://cdn.sudothy.me/{urllib.parse.quote(video_file)}"
    print(f"[*] Fetching audio stream: {url}")
    cmd = [
        "ffmpeg", "-y",
        "-i", url,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        out_wav
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if res.returncode != 0:
        print(f"[!] FFmpeg error: {res.stderr.decode('utf-8', errors='ignore')[:300]}")
        return False
    return True


def separate_vocals(input_wav: str, out_dir: str) -> str:
    """
    Runs Demucs to separate vocal stem.
    Returns path to vocals.wav
    """
    print("[*] Separating vocal stems via Demucs (htdemucs)...")
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "--two-stems", "vocals",
        "-n", "htdemucs",
        "--shifts", "0",
        "--overlap", "0.1",
        "-o", out_dir,
        input_wav
    ]
    if not torch.cuda.is_available():
        cmd.extend(["-d", "cpu"])
    else:
        cmd.extend(["-d", "cuda"])

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[!] Demucs separation failed:\n{res.stderr[:400]}")
        return input_wav

    stem_pattern = os.path.join(out_dir, "htdemucs", "*", "vocals.wav")
    matches = glob.glob(stem_pattern)
    if matches:
        return matches[0]
    return input_wav


def detect_vocal_end(
    wav_tensor: torch.Tensor,
    sample_rate: int,
    start_sec: float,
    limit_sec: float,
    avg_verse_dur: float
) -> float:
    """
    Detects where the vocal activity actually ends between start_sec and limit_sec.
    Bounds search to at most start_sec + 3.0s so subsequent verses or solos are never captured.
    """
    total_sec = len(wav_tensor) / sample_rate
    start_sec = max(0.0, start_sec)
    limit_sec = min(total_sec, limit_sec)

    if limit_sec <= start_sec:
        return round(start_sec + 0.5, 3)

    # Bound maximum phrase search window to 3.0s (singers almost never hold a single syllable longer)
    search_limit = min(limit_sec, start_sec + 3.0)

    start_sample = max(0, int((start_sec - 0.05) * sample_rate))
    end_sample = min(len(wav_tensor), int(search_limit * sample_rate))
    chunk = wav_tensor[start_sample:end_sample]

    fallback_hold = max(0.6, min(1.6, avg_verse_dur * 2.0))
    gap = limit_sec - start_sec

    if len(chunk) < 512:
        return round(start_sec + min(gap, fallback_hold), 3)

    timestamps = get_speech_timestamps(
        chunk,
        vad_model,
        sampling_rate=sample_rate,
        threshold=0.30,
        min_speech_duration_ms=80,
        min_silence_duration_ms=100
    )

    if timestamps:
        for ts in timestamps:
            seg_start_sec = (start_sample + ts['start']) / sample_rate
            seg_end_sec = (start_sample + ts['end']) / sample_rate
            # Look for the speech segment that encompasses or immediately continues the tapped onset
            if seg_start_sec <= start_sec + 0.4 and seg_end_sec > start_sec + 0.15:
                detected_end = min(limit_sec, seg_end_sec + 0.12)
                return round(max(start_sec + 0.3, detected_end), 3)

    # Fallback to rhythm-matched hold if vocal energy was soft/unvoiced
    return round(start_sec + min(gap, fallback_hold), 3)


def process_song_file(json_path: str, temp_base_dir: str):
    print(f"\n==================================================")
    print(f"[*] Processing: {os.path.basename(json_path)}")
    print(f"==================================================")

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    verses = data.get('lyricsData', [])
    if not verses:
        print("[!] No lyricsData found, skipping.")
        return

    video_file = data.get('videoFile')
    if not video_file:
        print("[!] No videoFile declared, skipping.")
        return

    song_slug = data.get('id', 'song')
    song_temp = os.path.join(temp_base_dir, song_slug)
    os.makedirs(song_temp, exist_ok=True)

    raw_wav = os.path.join(song_temp, "raw.wav")
    if not os.path.exists(raw_wav):
        ok = download_audio(video_file, raw_wav)
        if not ok:
            print(f"[!] Failed to download audio for {video_file}")
            return

    stem_cache_dir = os.path.expanduser(f"~/.cache/karaoke_stems/{song_slug}")
    os.makedirs(stem_cache_dir, exist_ok=True)
    cached_vocals = os.path.join(stem_cache_dir, "vocals.wav")

    if os.path.exists(cached_vocals):
        print(f"[*] Found cached vocal stem: {cached_vocals}")
        vocals_wav = cached_vocals
    else:
        vocals_wav = separate_vocals(raw_wav, song_temp)
        if os.path.exists(vocals_wav) and vocals_wav != raw_wav:
            import shutil
            shutil.copy2(vocals_wav, cached_vocals)
            vocals_wav = cached_vocals

    print(f"[*] Reading vocal stem: {vocals_wav}")
    wav_tensor, sr = sf.read(vocals_wav, dtype='float32')
    if wav_tensor.ndim > 1:
        wav_tensor = wav_tensor.mean(axis=1)
    wav_tensor = torch.from_numpy(wav_tensor)

    # Resample to 16000 Hz for Silero VAD
    if sr != 16000:
        import torchaudio.transforms as T
        resampler = T.Resample(orig_freq=sr, new_freq=16000)
        wav_tensor = resampler(wav_tensor)
        sr = 16000

    repaired_count = 0
    for i, v in enumerate(verses):
        words = v.get('words', [])
        if not words:
            continue

        inner_durs = [
            (w['end'] - w['start'])
            for w in words[:-1]
            if w.get('end', 0) > w.get('start', 0)
        ]
        avg_dur = float(np.mean(inner_durs)) if inner_durs else 0.35

        last_word = words[-1]
        start_t = float(last_word.get('start', 0))
        orig_end = float(last_word.get('end', 0))

        next_v = verses[i + 1] if i + 1 < len(verses) else None
        if next_v and next_v.get('words'):
            limit_t = float(next_v['words'][0]['start'])
        else:
            limit_t = len(wav_tensor) / sr

        new_end = detect_vocal_end(wav_tensor, sr, start_t, limit_t, avg_dur)
        last_word['end'] = new_end

        max_word_end = max(float(w.get('end', 0)) for w in words)
        if limit_t > max_word_end + 0.5:
            v['verseEnd'] = round(min(limit_t, max_word_end + 0.4), 3)
        else:
            v['verseEnd'] = round(max(float(v.get('verseEnd', 0)), max_word_end), 3)

        if abs(orig_end - new_end) > 0.05:
            repaired_count += 1
            print(f"  v[{i:02d}] '{last_word.get('word', '').strip()}': "
                  f"start={start_t:.2f}s | orig_end={orig_end:.2f}s -> detected_end={new_end:.2f}s "
                  f"(dur: {new_end - start_t:.2f}s, verseEnd: {v['verseEnd']:.2f}s)")

    print(f"[✓] Completed {os.path.basename(json_path)}: {repaired_count} verse endings acoustically calibrated.")

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <lyrics_dir_or_json_file>")
        sys.exit(1)

    target = sys.argv[1]
    if os.path.isdir(target):
        files = sorted(glob.glob(os.path.join(target, "*.json")))
    else:
        files = [target]

    print(f"[*] Found {len(files)} song lyric files to align.")
    with tempfile.TemporaryDirectory() as temp_dir:
        for fpath in files:
            try:
                process_song_file(fpath, temp_dir)
            except Exception as e:
                print(f"[!] Error processing {fpath}: {e}", file=sys.stderr)

    print("\n[🎉] All songs processed and acoustically aligned!")


if __name__ == '__main__':
    main()
