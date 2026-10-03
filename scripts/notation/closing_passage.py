"""Prepare existing MIDI attacks absent from the engraved reference; no inference dependencies."""

def prepare_closing_passage(performance, reference_end, media_end, settings=None):
    """Keep recorded attacks beyond the reference, with explicitly inferred rhythm.

    No new transcription/inference is run. The existing performance MIDI owns
    pitch, onset and release; a conservative eighth-note grid supplies readable
    notation for the passage absent from the engraved reference.
    """
    notes = [n for n in performance if n['start'] > reference_end]
    if not notes or media_end <= max(n['start'] for n in notes):
        raise ValueError('Closing passage needs attacks before mediaEnd')
    groups = []
    for note in notes:
        if not groups or note['start'] - groups[-1][0]['start'] > 0.04:
            groups.append([])
        groups[-1].append(note)
    settings = settings or {}
    beats = settings.get('rhythmBeats')
    if beats is not None and len(beats) != len(groups):
        raise ValueError('Reviewed rhythm must cover every recorded attack group')
    prepared = []
    tick = 0
    previous = groups[0][0]['start']
    for group_index, group in enumerate(groups):
        at = group[0]['start']
        if beats is not None:
            tick = round(beats[group_index] * 480)
        elif at > previous:
            tick += max(240, round((at - previous) / 0.45 * 2) * 240)
        for note in group:
            value = dict(id=f"n{len(prepared) + 1}", midi=note['midi'],
                audioStart=round(note['start'], 6), audioEnd=round(min(note['end'], media_end), 6),
                tick=tick, staff='lower' if note['midi'] < 60 else 'upper', voice=1, confidence=0.5)
            if settings.get('pitchClasses'):
                value['spelling'] = settings['pitchClasses'][note['midi'] % 12] + str(note['midi'] // 12 - 1)
            prepared.append(value)
        previous = at
    return dict(divisions=480, notes=prepared, mediaEnd=media_end,
        **{key: settings[key] for key in ('key', 'pickupQuarters') if key in settings},
        description='Existing performance MIDI; pitches and onsets retained. Reviewed phrase rhythm and enharmonic spelling; hands inferred by register.' if beats else
            'Existing performance MIDI; pitches/onsets/releases retained, rhythm and hands inferred on an eighth-note grid.')
