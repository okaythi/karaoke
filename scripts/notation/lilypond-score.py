"""Convert a resolved LilyPond music tree into the Theater's semantic score.

The input comes from export-lilypond.scm. LilyPond owns parsing, relative
pitch resolution and exact durations. This adapter owns no drawing rules.
Unsupported musical events fail explicitly; engraving overrides are ignored.
"""
import copy
import json
import re
from collections import defaultdict
from fractions import Fraction as Q

BASES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th', '128th']
STEPS = 'CDEFGAB'
SEMITONES = [0, 2, 4, 5, 7, 9, 11]
ORIGIN = {'origin': 'imported', 'rule': 'lilypond-source'}


def duration(value):
    base = Q(1, 2 ** value['log'])
    written = base * sum((Q(1, 2 ** dot) for dot in range(value['dots'] + 1)), Q(0))
    return written * Q(value['factor'])


def pitch(value):
    alter = int(value['alter'])
    return f"{STEPS[value['step']]}{ {-2:'bb', -1:'b', 0:'', 1:'#', 2:'##'}[alter]}{value['octave'] + 4}"


def midi(value):
    return 12 * (value['octave'] + 5) + SEMITONES[value['step']] + int(value['alter'])


def text(value):
    if isinstance(value, str):
        return '' if value.startswith('#<') or re.fullmatch(r'-?\d+(\.\d+)?', value) else value
    if isinstance(value, list):
        return ' '.join(filter(None, (text(item) for item in value)))
    return ''


class Converter:
    def __init__(self, meta):
        self.score = dict(schema=1, meta=meta,
            staves=[dict(id='upper', clef='treble'), dict(id='lower', clef='bass')],
            groups=[dict(kind='brace', staves=['upper', 'lower'])],
            measures=[], events=[], tuplets=[], clefs=[], attachments=[], spanners=[])
        self.attacks = []
        self.open = {}
        self.pending_ties = {}
        self.key_changes = {}
        self.time_changes = {}
        self.serial = defaultdict(int)
        self.ignored = defaultdict(int)

    def uid(self, label):
        self.serial[label] += 1
        return f'{label}.{self.serial[label]}'

    def anchor(self, at, staff):
        return {'position': dict(measure=int(at), offset=str(at % 1), staff=staff)}

    def attachment(self, kind, anchor, **params):
        self.score['attachments'].append(dict(id=self.uid(kind), kind=kind,
            anchor=anchor, provenance=ORIGIN, **params))

    def span(self, kind, start, end, **params):
        self.score['spanners'].append(dict(id=self.uid(kind), kind=kind,
            start=start, end=end, provenance=ORIGIN, **params))

    def marks(self, marks, anchor, state, event=None):
        voice = (state['home'], state['voice'])
        for mark in marks:
            name = mark['name']
            if name == 'TieEvent':
                if not event or event['kind'] != 'chord':
                    raise ValueError('Tie without a chord')
                self.pending_ties[voice] = {n['pitch']: n['id'] for n in event['notes']}
            elif name == 'AbsoluteDynamicEvent':
                self.attachment('dyn.' + mark['text'], anchor)
            elif name == 'ArticulationEvent':
                kind = {'accent': 'artic.accent', 'staccato': 'artic.staccato',
                    'staccatissimo': 'artic.staccatissimo', 'tenuto': 'artic.tenuto',
                    'trill': 'orn.trill', 'fermata': 'artic.fermata'}.get(mark['articulation-type'])
                if not kind:
                    raise ValueError(f'Unsupported articulation: {mark}')
                self.attachment(kind, anchor)
            elif name in ('SlurEvent', 'CrescendoEvent', 'DecrescendoEvent', 'SustainEvent', 'TextSpanEvent'):
                if name == 'SlurEvent' and mark.get('spanner-id') == 'grace':
                    # Grace/main-note connections are supplied by the grace model.
                    continue
                key = (voice, 'dynamics' if name in ('CrescendoEvent', 'DecrescendoEvent') else name)
                if mark['span-direction'] == -1:
                    if key in self.open:
                        oldkind, oldanchor, extra = self.open.pop(key)
                        self.span(oldkind, oldanchor, anchor, **extra)
                    kind = {'SlurEvent': 'slur', 'CrescendoEvent': 'dyn.hairpin-cresc',
                        'DecrescendoEvent': 'dyn.hairpin-dim', 'SustainEvent': 'pedal.bracket',
                        'TextSpanEvent': 'tempo.change'}[name]
                    extra = {'text': state.get('spanText', 'riten.')} if name == 'TextSpanEvent' else {}
                    if name == 'CrescendoEvent' and state.get('crescendoText'):
                        kind = 'dyn.text-cresc'; extra = {'text': state['crescendoText']}
                    if name == 'DecrescendoEvent' and state.get('decrescendoText'):
                        kind = 'dyn.text-dim'; extra = {'text': state['decrescendoText']}
                    self.open[key] = (kind, anchor, extra)
                elif key in self.open:
                    kind, start, extra = self.open.pop(key)
                    self.span(kind, start, anchor, **extra)
            elif name == 'TextScriptEvent':
                words = text(mark['text'])
                if words:
                    kind = 'tempo.return' if words == 'a tempo' else 'tempo.text' if 'bold-markup' in json.dumps(mark['text']) else 'expr.text'
                    self.attachment(kind, anchor, text=words,
                        side='above' if mark.get('direction', 1) > 0 else 'below')
            elif name == 'ArpeggioEvent':
                self.attachment('arp.plain', anchor)
            elif name == 'BeamEvent':
                # Beams are derived from meter and written values at layout time.
                continue
            else:
                raise ValueError(f'Unsupported attached music event: {name}')

    def walk(self, node, at, state):
        name = node['name']
        if name in ('RelativeOctaveMusic', 'ContextSpeccedMusic'):
            return self.walk(node['element'], at, state)
        if name == 'SequentialMusic':
            for child in node.get('elements', []):
                at = self.walk(child, at, state)
            return at
        if name == 'UnfoldedRepeatedMusic':
            if node.get('elements'):
                raise ValueError('Repeat alternatives need explicit navigation')
            for _ in range(node['repeat-count']):
                at = self.walk(node['element'], at, state)
            return at
        if name == 'SimultaneousMusic':
            branches = [child for child in node['elements'] if child['name'] != 'VoiceSeparator']
            ends = []
            for number, child in enumerate(branches, 1):
                branch = copy.copy(state)
                branch['voice'] = number
                ends.append(self.walk(child, at, branch))
            return max(ends, default=at)
        if name == 'GraceMusic':
            grace = copy.copy(state)
            grace['grace'] = 'acciaccatura' if 'stroke-style' in json.dumps(node) else 'appoggiatura'
            grace['graceOrder'] = 0
            self.walk(node['element'], at, grace)
            return at
        if name == 'TimeScaledMusic':
            scaled = copy.copy(state)
            ratio = Q(node['numerator'], node['denominator'])
            scaled['tupletRatio'] = ratio
            scaled['tupletStart'] = at
            # Long runs of triplets are independent quarter-note groups.
            scaled['tupletGroup'] = Q(1, 4) if ratio == Q(2, 3) else None
            scaled['tupletToken'] = self.uid('tuplet-source')
            return self.walk(node['element'], at, scaled)
        if name in ('NoteEvent', 'RestEvent', 'SkipEvent', 'EventChord'):
            members = node.get('elements', []) if name == 'EventChord' else [node]
            sounding = [m for m in members if m['name'] in ('NoteEvent', 'RestEvent', 'SkipEvent')]
            if not sounding:
                self.marks(members, self.anchor(at, state['staff']), state)
                return at
            durations = {duration(m['duration']) for m in sounding}
            if len(durations) != 1:
                raise ValueError('A chord has mixed durations')
            length = durations.pop()
            notes = [m for m in sounding if m['name'] == 'NoteEvent']
            eventid = f"{state['home']}.{int(at) + 1}.{state['voice']}.{at % 1}"
            if state.get('grace'):
                eventid += f".g{state['graceOrder']}"
            event = dict(id=eventid, kind='chord' if notes else ('space' if name == 'SkipEvent' else 'rest'),
                measure=int(at), offset=str(at % 1), staff=state['home'], voice=state['voice'], provenance=ORIGIN)
            value = sounding[0]['duration']
            if event['kind'] == 'space':
                event['length'] = str(length)
            else:
                event['value'] = dict(base=BASES[value['log']], dots=value['dots'])
                ratio = state.get('tupletRatio')
                if ratio and Q(value['factor']) != 1:
                    group = state['tupletGroup']
                    label = str(int(at / group)) if group else state['tupletToken']
                    tid = f"tuplet.{state['home']}.{state['voice']}.{label}"
                    if not any(t['id'] == tid for t in self.score['tuplets']):
                        self.score['tuplets'].append(dict(id=tid, actual=ratio.denominator,
                            normal=ratio.numerator, provenance=ORIGIN))
                    event['tuplet'] = tid
                if event['kind'] == 'rest' and length == 1 and at % 1 == 0:
                    event['fullBar'] = True
            if notes:
                event['notes'] = []
                pending = self.pending_ties.pop((state['home'], state['voice']), {})
                tied_count = 0
                for n in notes:
                    spelling = pitch(n['pitch'])
                    nid = eventid + ':' + spelling
                    newnote = dict(id=nid, pitch=spelling, provenance=ORIGIN)
                    if state['staff'] != state['home']:
                        newnote['staff'] = state['staff']
                    event['notes'].append(newnote)
                    if spelling in pending:
                        self.span('tie', {'note': pending.pop(spelling)}, {'note': nid})
                        tied_count += 1
                    self.attacks.append(dict(id=nid, midi=midi(n['pitch']), position=float(at),
                        length=float(length), staff=state['home'], grace=bool(state.get('grace'))))
                if pending and not tied_count:
                    raise ValueError(f'Unresolved tied pitches: {pending}')
            if state.get('grace'):
                event['grace'] = dict(kind=state['grace'], placement='before')
                event['graceOrder'] = state['graceOrder']
                state['graceOrder'] += 1
            if state.get('stem') and notes:
                event['stem'] = state['stem']
            self.score['events'].append(event)
            marks = [m for m in members if m not in sounding]
            for n in sounding:
                marks.extend(n.get('articulations', []))
            self.marks(marks, {'event': eventid}, state, event)
            return at if state.get('grace') else at + length
        if name == 'BarCheck':
            if at.denominator != 1:
                raise ValueError(f'Bar check at {at} in {state["home"]}')
        elif name == 'ContextChange':
            if node['change-to-type'] != 'Staff':
                raise ValueError('Unsupported context change')
            state['staff'] = node['change-to-id']
        elif name == 'TimeSignatureMusic':
            value = dict(beats=node['numerator'], beatType=node['denominator'], symbol='common')
            if value['beats'] != 4 or value['beatType'] != 4:
                raise ValueError('This adapter currently requires whole-note measures')
            self.time_changes[int(at)] = value
        elif name == 'KeyChangeEvent':
            alist = node['pitch-alist']
            fifths = sum(1 if '1/2)' in item and '-1/2)' not in item else -1 if '-1/2)' in item else 0 for item in alist)
            # Major/minor is determined by the tonic against its key signature.
            tonic = node['tonic']
            tonic_pc = (SEMITONES[tonic['step']] + int(tonic['alter'])) % 12
            mode = 'minor' if (tonic_pc - 7 * fifths) % 12 == 9 else 'major'
            self.key_changes[int(at)] = dict(fifths=fifths, mode=mode)
        elif name == 'TempoChangeEvent':
            self.attachment('tempo.metronome', self.anchor(at, state['staff']),
                params=dict(bpm=node['metronome-count'], unit=BASES[node['tempo-unit']['log']]))
        elif name == 'OttavaEvent':
            key = (state['home'], 'ottava')
            anchor = self.anchor(at, state['staff'])
            if key in self.open:
                kind, start, extra = self.open.pop(key)
                self.span(kind, start, anchor, **extra)
            number = node['ottava-number']
            if number:
                kind = {1:'ottava.8va', -1:'ottava.8vb', 2:'ottava.15ma', -2:'ottava.15mb'}[number]
                self.open[key] = (kind, anchor, {})
        elif name == 'PropertySet':
            symbol = node['symbol']; value = node['value']
            if symbol == 'clefGlyph':
                clef = {'clefs.G': 'treble', 'clefs.F': 'bass'}.get(value)
                if not clef:
                    raise ValueError(f'Unsupported clef {value}')
                self.score['clefs'].append(dict(id=self.uid('clef'), staff=state['staff'],
                    measure=int(at), offset=str(at % 1), clef=clef, provenance=ORIGIN))
            elif symbol in ('crescendoText', 'decrescendoText'):
                state[symbol] = text(value)
            elif symbol == 'stemDirection':
                state['stem'] = 'up' if value == 1 else 'down' if value == -1 else None
        elif name == 'PropertyUnset':
            state.pop(node['symbol'], None)
        elif name in ('OverrideProperty', 'RevertProperty', 'ApplyContext', 'ApplyOutputEvent', 'LineBreakEvent'):
            if name == 'OverrideProperty' and node.get('symbol') == 'TextSpanner' and 'left' in node.get('grob-property-path', []):
                state['spanText'] = text(node['grob-value'])
            self.ignored[name] += 1
        else:
            raise ValueError(f'Unsupported musical node: {name}')
        return at

    def convert(self, tree):
        ends = []
        for staff, node in tree.items():
            ends.append(self.walk(node, Q(0), dict(home=staff, staff=staff, voice=1)))
        if len(set(ends)) != 1 or ends[0].denominator != 1:
            raise ValueError(f'Unequal staff lengths: {ends}')
        count = int(ends[0])
        self.score['measures'] = [dict(number=i + 1,
            **({'key': self.key_changes[i]} if i in self.key_changes else {}),
            **({'time': self.time_changes[i]} if i in self.time_changes else {}),
            **({'end': 'barline.final'} if i == count - 1 else {})) for i in range(count)]
        for key, (kind, start, params) in list(self.open.items()):
            self.span(kind, start, self.anchor(Q(count - 1) + Q(1), key[0] if isinstance(key[0], str) else key[0][0]), **params)
        # Position anchors at the end of the score belong to its final bar.
        for item in self.score['spanners'] + self.score['attachments']:
            for field in ('anchor', 'start', 'end'):
                p = item.get(field, {}).get('position')
                if p and p['measure'] == count:
                    p['measure'] -= 1; p['offset'] = '1'
        self.score['clefs'] = [c for c in self.score['clefs'] if c['measure'] or c['offset'] != '0']
        self.score['events'].sort(key=lambda e: (e['measure'], Q(e['offset']), e['staff'], e['voice'], e.get('graceOrder', 100)))
        return self.score, self.attacks
