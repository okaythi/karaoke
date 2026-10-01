"""Derive an editable 3/4 engraving draft from exact performance events.

Only score positions/durations are quantized. Source MIDI times are never edited.
The beat grid follows the recurring lower-register attacks and is used solely
for notation. IDs link every score event to its performance event.
"""
from __future__ import annotations
import json
from bisect import bisect_left
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'src/data/score/itsumo-midi.json').read_text())
notes = source['notes']
# Lower-register attacks supply the recurring quarter-note pulse. Simultaneous
# chord pitches are collapsed, preserving a single beat candidate.
attacks = []
for note in notes:
    if note['pitch'] < 72:
        time = note['startTime']
        if not attacks or time - attacks[-1] > .12:
            attacks.append(time)
origin = attacks[0]
beats = [origin]
pulse = .51
while beats[-1] < source['duration'] + 2:
    expected = beats[-1] + pulse
    index = bisect_left(attacks, expected)
    candidates = attacks[max(0, index - 1):index + 2]
    close = [t for t in candidates if abs(t - expected) < min(.20, pulse * .38)]
    observed = min(close, key=lambda t: abs(t - expected)) if close else None
    if observed is None:
        beats.append(round(expected, 6))
    else:
        interval = observed - beats[-1]
        beats.append(observed)
        pulse = max(.38, min(.7, .8 * pulse + .2 * interval))

values = [(.25, '16', False), (.375, '16', True), (.5, '8', False),
          (.75, '8', True), (1., 'q', False), (1.5, 'q', True),
          (2., 'h', False), (3., 'h', True)]

def position(time):
    index = max(0, min(len(beats)-2, bisect_left(beats, time)-1))
    while index+1 < len(beats)-1 and time >= beats[index+1]: index += 1
    fraction = (time - beats[index]) / (beats[index+1] - beats[index])
    return max(0, round((index + fraction) * 4) / 4)

score = []
# Transkun often staggers the pitches of one attack by a few MIDI ticks.
# Form the attack from raw onsets before quantizing any of its pitches.
ATTACK_WINDOW_SECONDS = .03
attack_start = None
attack_pitches = set()
attack_position = None
for note in notes:
    pitch_key = (note['channel'], note['pitch'])
    if (attack_start is None or note['startTime'] - attack_start > ATTACK_WINDOW_SECONDS
            or pitch_key in attack_pitches):
        attack_start = note['startTime']
        attack_pitches = set()
        attack_position = position(attack_start)
    attack_pitches.add(pitch_key)
    start = attack_position
    end = position(note['endTime'])
    raw_length = max(.125, end - start)
    duration, glyph, dotted = min(values, key=lambda item: abs(item[0]-raw_length))
    # A final short release before a following onset may be an articulation;
    # the visible value remains a conventional rhythmic symbol.
    score.append({'performanceId': note['id'], 'pitch': note['pitch'],
                  'scoreStart': start, 'scoreDuration': duration,
                  'duration': glyph, 'dotted': dotted,
                  'measure': int(start // 3), 'beat': round(start % 3, 4),
                  'onsetErrorMs': round((note['startTime'] -
                      (beats[int(start)] + (start % 1) * (beats[int(start)+1]-beats[int(start)]))) * 1000, 1)})
result = {'source': 'itsumo-midi.json', 'timeSignature': {'numerator': 3, 'denominator': 4},
          'keySignature': 'E', 'subdivisionsPerQuarter': 4,
          'beatGridSeconds': beats, 'events': score}
out = ROOT / 'src/data/score/itsumo-notation.json'
out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
print(f'Derived {len(score)} notation events, {len(beats)} engraving beats')
