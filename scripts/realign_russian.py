import json
import re
import difflib
import torch
import soundfile as sf
import torchaudio.transforms as T
from silero_vad import load_silero_vad, get_speech_timestamps

print("Loading VAD model...")
vad_model = load_silero_vad()

with open("/home/azureuser/karaoke_work/whisper_words.json", "r", encoding="utf-8") as f:
    whisper_words = json.load(f)

with open("/home/azureuser/karaoke_work/lyrics/ic3peak-boo-hoo.json", "r", encoding="utf-8") as f:
    song_data = json.load(f)

audio_path = "/home/azureuser/.cache/karaoke_stems/ic3peak-boo-hoo/vocals.wav"
wav_tensor, sr = sf.read(audio_path, dtype="float32")
if wav_tensor.ndim > 1:
    wav_tensor = wav_tensor.mean(axis=1)
wav_tensor = torch.from_numpy(wav_tensor)

if sr != 16000:
    resampler = T.Resample(orig_freq=sr, new_freq=16000)
    wav_tensor = resampler(wav_tensor)
    sr = 16000

def norm(w):
    return re.sub(r"[^а-яёa-z0-9]", "", w.lower())

def is_similar(w1, w2):
    n1 = norm(w1)
    n2 = norm(w2)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    if n1 in n2 or n2 in n1:
        return True
    return difflib.SequenceMatcher(None, n1, n2).ratio() >= 0.60

verses = song_data["lyricsData"]
print(f"Starting alignment for {len(verses)} verses against {len(whisper_words)} Whisper words...")

for v_idx, v in enumerate(verses):
    v_words = v["words"]
    if not v_words:
        continue

    v_start_orig = v.get("verseStart", 0.0)
    v_end_orig = v.get("verseEnd", 0.0)

    # Separate lead words from trailing (плак-плак)
    lead_indices = []
    adlib_indices = []
    for wi, w in enumerate(v_words):
        n = norm(w["word"])
        if ("плак" in n or "(" in w["word"] or ")" in w["word"]) and wi >= len(v_words) - 4 and len(v_words) > 4:
            adlib_indices.append(wi)
        else:
            lead_indices.append(wi)

    if not lead_indices:
        lead_indices = list(range(len(v_words)))
        adlib_indices = []

    # Filter candidate whisper words strictly within local time window
    # User's vibe-sync is within +/- 2.5s of the actual verse
    cands = [w for w in whisper_words if (v_start_orig - 2.5) <= w["start"] <= (v_end_orig + 2.0)]

    best_matches = {}
    curr_c_search = 0

    for li in lead_indices:
        target_norm = norm(v_words[li]["word"])
        if not target_norm:
            continue
        for ci in range(curr_c_search, len(cands)):
            cand = cands[ci]
            if is_similar(target_norm, cand["word"]):
                best_matches[li] = cand
                curr_c_search = ci + 1
                break

    # If we found matches
    if len(best_matches) >= 2 or (len(lead_indices) <= 3 and len(best_matches) >= 1):
        for li, cand in best_matches.items():
            v_words[li]["start"] = cand["start"]
            v_words[li]["end"] = cand["end"]

        # Interpolate unmatched lead words
        for idx_pos, li in enumerate(lead_indices):
            if li not in best_matches:
                prev_li = next((lead_indices[p] for p in range(idx_pos - 1, -1, -1) if lead_indices[p] in best_matches), None)
                next_li = next((lead_indices[p] for p in range(idx_pos + 1, len(lead_indices)) if lead_indices[p] in best_matches), None)

                if prev_li is not None and next_li is not None:
                    p_end = v_words[prev_li]["end"]
                    n_start = v_words[next_li]["start"]
                    span = max(0.08, n_start - p_end)
                    gap_count = lead_indices.index(next_li) - lead_indices.index(prev_li)
                    step = span / gap_count
                    offset_idx = lead_indices.index(li) - lead_indices.index(prev_li)
                    v_words[li]["start"] = round(p_end + step * (offset_idx - 1) + 0.02, 3)
                    v_words[li]["end"] = round(p_end + step * offset_idx, 3)
                elif prev_li is not None:
                    p_end = v_words[prev_li]["end"]
                    v_words[li]["start"] = round(p_end + 0.04, 3)
                    v_words[li]["end"] = round(v_words[li]["start"] + 0.30, 3)
                elif next_li is not None:
                    n_start = v_words[next_li]["start"]
                    v_words[li]["end"] = round(n_start - 0.04, 3)
                    v_words[li]["start"] = round(max(0, v_words[li]["end"] - 0.30), 3)

        # Handle trailing adlibs like (плак-плак)
        if adlib_indices:
            last_lead_end = v_words[lead_indices[-1]]["end"]
            adlib_start = round(last_lead_end + 0.12, 3)
            adlib_end = round(adlib_start + 0.65, 3)
            for ai in adlib_indices:
                v_words[ai]["start"] = adlib_start
                v_words[ai]["end"] = adlib_end

    # Monotonicity check
    for wi in range(1, len(v_words)):
        if v_words[wi]["start"] < v_words[wi - 1]["start"]:
            v_words[wi]["start"] = round(v_words[wi - 1]["start"] + 0.06, 3)
        if v_words[wi]["end"] <= v_words[wi]["start"]:
            v_words[wi]["end"] = round(v_words[wi]["start"] + 0.20, 3)

    first_w_start = min(w["start"] for w in v_words)
    v["verseStart"] = round(first_w_start, 3)

    # Use VAD to detect exact verse ending cutoff
    last_w = v_words[-1]
    t_seek_start = max(0.0, last_w["start"] - 0.05)
    t_seek_end = min(len(wav_tensor) / sr, last_w["start"] + 2.2)

    s_samp = int(t_seek_start * sr)
    e_samp = int(t_seek_end * sr)
    chunk = wav_tensor[s_samp:e_samp]
    ts = get_speech_timestamps(chunk, vad_model, sampling_rate=sr, threshold=0.25, min_speech_duration_ms=60)
    
    if ts:
        detected_last_end = (s_samp + ts[-1]["end"]) / sr
        last_w["end"] = round(min(t_seek_end, detected_last_end + 0.10), 3)
    else:
        last_w["end"] = round(last_w["start"] + 0.40, 3)

    max_end = max(w["end"] for w in v_words)
    v["verseEnd"] = round(max_end + 0.30, 3)

    line_preview = "".join(w["word"] for w in v_words).strip()
    match_stat = f"{len(best_matches)}/{len(lead_indices)} words matched"
    print(f"v[{v_idx:02d}] {v['verseStart']:6.2f}s - {v['verseEnd']:6.2f}s ({match_stat:20s}) | {line_preview}")

out_path = "/home/azureuser/karaoke_work/lyrics/ic3peak-boo-hoo.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(song_data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"\n[✓] Successfully realigned all 50 verses and saved to {out_path}!")
