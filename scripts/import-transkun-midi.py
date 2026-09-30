"""Import the exact-performance Transkun MIDI as lossless event data.

Run with `python3 scripts/import-transkun-midi.py` after installing `mido`.
The source MIDI is never modified and stays outside Git. Timing in the JSON
comes directly from MIDI ticks and tempo messages, never from score alignment.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import mido

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'itsumo-transcribed.mid'
DEST = ROOT / 'src/data/score/itsumo-midi.json'


def main() -> None:
    midi = mido.MidiFile(SOURCE)
    if midi.type not in (0, 1):
        raise ValueError(f'Unsupported MIDI type {midi.type}')
    tempo = 500000
    ticks = 0
    seconds = 0.0
    open_notes: dict[tuple[int, int], list[tuple[int, float, int]]] = defaultdict(list)
    notes: list[dict] = []
    pedals: list[dict] = []
    tempo_events: list[dict] = []
    pedal_down: dict[int, tuple[int, float]] = {}
    programs: list[dict] = []
    time_signature = None

    for event in mido.merge_tracks(midi.tracks):
        ticks += event.time
        seconds += mido.tick2second(event.time, midi.ticks_per_beat, tempo)
        if event.type == 'set_tempo':
            tempo = event.tempo
            tempo_events.append({'tick': ticks, 'time': round(seconds, 6), 'microsecondsPerQuarter': tempo})
        elif event.type == 'time_signature':
            time_signature = {'numerator': event.numerator, 'denominator': event.denominator, 'tick': ticks}
        elif event.type == 'program_change':
            programs.append({'channel': event.channel, 'program': event.program, 'tick': ticks})
        elif event.type == 'control_change' and event.control == 64:
            if event.value >= 64 and event.channel not in pedal_down:
                pedal_down[event.channel] = (ticks, seconds)
            elif event.value < 64 and event.channel in pedal_down:
                start_tick, start_time = pedal_down.pop(event.channel)
                pedals.append({
                    'channel': event.channel,
                    'startTick': start_tick,
                    'endTick': ticks,
                    'startTime': round(start_time, 6),
                    'endTime': round(seconds, 6)
                })
        elif event.type == 'note_on' and event.velocity > 0:
            open_notes[(event.channel, event.note)].append((ticks, seconds, event.velocity))
        elif event.type == 'note_off' or (event.type == 'note_on' and event.velocity == 0):
            key = (event.channel, event.note)
            if not open_notes[key]:
                raise ValueError(f'Unpaired note-off at tick {ticks}: {key}')
            start_tick, start_time, velocity = open_notes[key].pop(0)
            notes.append({
                'pitch': event.note,
                'channel': event.channel,
                'velocity': velocity,
                'startTick': start_tick,
                'endTick': ticks,
                'startTime': round(start_time, 6),
                'endTime': round(seconds, 6),
                'source': 'transkun'
            })

    if any(open_notes.values()):
        raise ValueError('MIDI contains unclosed notes')
    notes.sort(key=lambda note: (note['startTick'], note['pitch'], note['endTick']))
    for index, note in enumerate(notes):
        note['id'] = f'midi-{index:04d}'
        note['soundingEndTime'] = note['endTime']
        note['soundingEndTick'] = note['endTick']
        for pedal in pedals:
            if (pedal['channel'] == note['channel'] and
                    pedal['startTime'] <= note['endTime'] < pedal['endTime']):
                note['soundingEndTime'] = pedal['endTime']
                note['soundingEndTick'] = pedal['endTick']
                break
    # Retriggering the same pitch terminates the previous pedal-held event.
    by_pitch: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for note in notes:
        by_pitch[(note['channel'], note['pitch'])].append(note)
    for group in by_pitch.values():
        for current, following in zip(group, group[1:]):
            current['soundingEndTime'] = max(current['endTime'], round(min(current['soundingEndTime'], following['startTime']), 6))
            current['soundingEndTick'] = max(current['endTick'], min(current['soundingEndTick'], following['startTick']))

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps({
        'source': SOURCE.name,
        'format': midi.type,
        'ticksPerQuarter': midi.ticks_per_beat,
        'duration': round(seconds, 6),
        'timeSignature': time_signature,
        'tempoEvents': tempo_events,
        'programs': programs,
        'pedals': pedals,
        'notes': notes
    }, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Imported {len(notes)} notes and {len(pedals)} pedal intervals into {DEST}')


if __name__ == '__main__':
    main()
