"""Prepare a LilyPond score and align its attacks to a performance MIDI.

python3 scripts/notation/align-score.py <song-id>
Dependencies: requirements.txt in this directory. No inference runs in the
browser. The MP3 timeline is retained, including its leading silence.
"""
import hashlib
import importlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import mido
import numpy as np
from numba import njit

Converter = importlib.import_module('lilypond-score').Converter


def read_midi(path):
    file = mido.MidiFile(path)
    tempo = 500000
    at = 0.0
    active = defaultdict(list)
    notes = []
    for message in mido.merge_tracks(file.tracks):
        at += mido.tick2second(message.time, file.ticks_per_beat, tempo)
        if message.type == 'set_tempo':
            tempo = message.tempo
        elif message.type == 'note_on' and message.velocity:
            active[(message.channel, message.note)].append(at)
        elif message.type == 'note_off' or (message.type == 'note_on' and not message.velocity):
            key = (message.channel, message.note)
            if active[key]:
                start = active[key].pop(0)
                notes.append(dict(midi=message.note, start=start, end=at))
    if any(active.values()):
        raise ValueError('Unterminated MIDI notes')
    return sorted(notes, key=lambda n: (n['start'], n['midi']))


def group_order(notes, tolerance=0.018):
    """Near-simultaneous piano attacks use pitch order, independent of roll."""
    groups = []
    for note in notes:
        if not groups or note['start'] - groups[-1][0]['start'] > tolerance:
            groups.append([])
        groups[-1].append(note)
    return [n for group in groups for n in sorted(group, key=lambda n: n['midi'])]


@njit(cache=True)
def match_sequence(left, right):
    """Global pitch edit alignment. Insertions cover ornaments/transcript noise."""
    n, m = len(left), len(right)
    trace = np.zeros((n + 1, m + 1), dtype=np.uint8)
    previous = np.arange(m + 1, dtype=np.int32)
    for i in range(1, n + 1):
        current = np.empty(m + 1, dtype=np.int32)
        current[0] = i
        for j in range(1, m + 1):
            diagonal = previous[j - 1] + (0 if left[i - 1] == right[j - 1] else 3)
            delete = previous[j] + 1
            insert = current[j - 1] + 1
            if diagonal <= delete and diagonal <= insert:
                current[j] = diagonal; trace[i, j] = 0
            elif delete <= insert:
                current[j] = delete; trace[i, j] = 1
            else:
                current[j] = insert; trace[i, j] = 2
        previous = current
    pairs = []
    # Ignore a performance suffix (e.g. outro music). A global end-to-end
    # match would drag the final chord onto unrelated later notes.
    terminal = m
    terminal_cost = np.iinfo(np.int32).max
    for candidate in range(1, m + 1):
        if trace[n, candidate] == 0 and n > 0 and left[n - 1] == right[candidate - 1] and previous[candidate] < terminal_cost:
            terminal = candidate; terminal_cost = previous[candidate]
    i, j = n, terminal
    while i > 0 and j > 0:
        direction = trace[i, j]
        if direction == 0:
            if left[i - 1] == right[j - 1]:
                pairs.append((i - 1, j - 1))
            i -= 1; j -= 1
        elif direction == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def align(score, notes, performance, settings):
    tied = {s['end']['note']: s['start']['note'] for s in score['spanners'] if s['kind'] == 'tie'}
    written_attacks = sorted((n for n in notes if n['id'] not in tied),
        key=lambda n: (n['position'], 0 if n['grace'] else 1, n['id'].split('.g')[-1].split(':')[0] if n['grace'] else '', n['midi']))
    attacks = []
    shared = {}
    physical = {}
    for note in written_attacks:
        # Two contrapuntal voices can write the same piano key at one onset.
        # Grace notes at that position are separate preceding attacks.
        key = (note['position'], note['midi'], note['id'] if note['grace'] else '')
        if key in physical:
            shared[note['id']] = physical[key]
        else:
            physical[key] = note['id']; attacks.append(note)
    performed = group_order(performance)
    pairs = match_sequence(np.array([n['midi'] for n in attacks]), np.array([n['midi'] for n in performed]))
    matched = {attacks[i]['id']: performed[j] for i, j in pairs}
    anchors = defaultdict(list)
    for i, j in pairs:
        if not attacks[i]['grace']:
            anchors[attacks[i]['position']].append(performed[j]['start'])
    knots = []
    for position in sorted(anchors):
        time = float(np.median(anchors[position]))
        if not knots or time > knots[-1][1]:
            knots.append((position, time))
    if len(knots) < 2:
        raise ValueError('Not enough performance anchors')
    positions, times = np.array(knots).T

    def time_at(position):
        if position < positions[0]:
            return float(times[0] + (position - positions[0]) * (times[1] - times[0]) / (positions[1] - positions[0]))
        if position > positions[-1]:
            return float(times[-1] + (position - positions[-1]) * (times[-1] - times[-2]) / (positions[-1] - positions[-2]))
        return float(np.interp(position, positions, times))

    used = {j for _, j in pairs}
    recovered = 0
    candidates = []
    for note in attacks:
        if note['id'] in matched:
            continue
        predicted = time_at(note['position'])
        for j, candidate in enumerate(performed):
            distance = abs(candidate['start'] - predicted)
            if j not in used and candidate['midi'] == note['midi'] and distance <= settings.get('recoverSeconds', 0.085):
                candidates.append((distance, note['id'], j))
    for _, nid, j in sorted(candidates):
        if nid not in matched and j not in used:
            matched[nid] = performed[j]; used.add(j); recovered += 1
    for nid, root in shared.items():
        if root in matched:
            matched[nid] = matched[root]

    # The final written sustain ends in the recording, rather than extending
    # the fast tempo of the closing flourish across its last two bars.
    end_position = float(len(score['measures']))
    end_time = settings['performanceEnd']
    if end_time <= times[-1]:
        raise ValueError('performanceEnd must follow the final attack')
    positions = np.append(positions, end_position)
    times = np.append(times, end_time)
    timing = {}
    unresolved = []
    for note in notes:
        pos = note['position']
        performance_note = matched.get(note['id'])
        is_tie = note['id'] in tied
        start = time_at(pos)
        if performance_note:
            start = performance_note['start']
        elif not is_tie:
            unresolved.append(dict(id=note['id'], measure=int(pos) + 1,
                midi=note['midi'], position=pos, predictedTime=round(start, 6)))
        # Follow a held note's original recorded release through written ties.
        root = note['id']
        while root in tied:
            root = tied[root]
        release = matched.get(root, {}).get('end', time_at(pos + note['length']))
        written_end = time_at(pos + note['length'])
        if note['grace']:
            written_end = performance_note['end'] if performance_note else start + 0.06
        glide_end = max(start + 0.01, written_end)
        timing[note['id']] = dict(start=round(start, 6), glideEnd=round(glide_end, 6),
            soundingEnd=round(max(glide_end, release), 6))
    beats = [dict(position=i / 4, time=round(time_at(i / 4), 6)) for i in range(len(score['measures']) * 4 + 1)]
    gaps = [(positions[i], positions[i + 1], times[i + 1] - times[i]) for i in range(len(positions) - 1)]
    report = dict(scoreNotes=len(notes), scoreAttacks=len(written_attacks), physicalScoreAttacks=len(attacks),
        sharedPerformedAttacks=len(shared), performedNotes=len(performance),
        orderedMatches=len(pairs), locallyRecovered=recovered,
        matchedAttacks=len(matched), matchRate=round(len(matched) / len(written_attacks), 5),
        interpolatedAttacks=unresolved, extraPerformedNotes=len(performance) - len(used),
        trailingPerformedNotes=sum(n['start'] > end_time for n in performance),
        firstAttack=round(min(n['start'] for n in performance), 6), performanceEnd=end_time,
        largestAnchorGaps=[dict(fromPosition=float(a), toPosition=float(b), seconds=round(float(c), 6))
            for a, b, c in sorted(gaps, key=lambda g: g[2], reverse=True)[:12]],
        status='needs-review' if unresolved else 'aligned')
    return dict(notes=timing, beats=beats), report


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: align-score.py <song-id>')
    folder = Path('src/data/score') / sys.argv[1]
    settings = json.loads((folder / 'song.json').read_text())
    prep = settings['preparation']
    tree = json.loads((folder / prep['music']).read_text())
    converter = Converter(settings['meta'])
    score, notes = converter.convert(tree)
    performance = read_midi(folder / prep['performanceMidi'])
    timing, report = align(score, notes, performance, prep)
    reference = read_midi(folder / prep['referenceMidi'])
    report['referenceMidiNotes'] = len(reference)
    tied = {s['end']['note'] for s in score['spanners'] if s['kind'] == 'tie'}
    physical = {(n['position'], n['midi'], n['id'] if n['grace'] else ''): n['midi']
        for n in notes if n['id'] not in tied}
    report['referencePitchesVerified'] = Counter(physical.values()) == Counter(n['midi'] for n in reference)
    if not report['referencePitchesVerified']:
        raise ValueError('Resolved source pitches do not agree with the reference MIDI')
    report['sources'] = {name: dict(file=str(folder / value), sha256=hashlib.sha256((folder / value).read_bytes()).hexdigest())
        for name, value in prep.items() if name in ('music', 'referenceMidi', 'performanceMidi', 'audio')}
    for name, value in [('source/score.json', score), ('source/timing.json', timing), ('alignment-report.json', report)]:
        (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n')
    print(f"{sys.argv[1]}: {len(score['measures'])} bars, {len(notes)} notes, {report['matchRate']:.1%} matched attacks; {len(report['interpolatedAttacks'])} interpolated")


if __name__ == '__main__':
    main()
