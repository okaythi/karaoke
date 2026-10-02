import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';
const PEDAL_MUSIC = 'upper: E5/4 G5 E5 G5 | F5/4 A5 F5 A5 | G5/1 |\n';

const ottava = <const Id extends string>(id: Id, name: string, glyph: string, continued: string, side: 'above' | 'below',
  writtenOctaves: number, summary: string, example: string) => ({
  id, family: 'ottava', name, summary, spec: '5.16', model: 'spanner', anchor: 'event', endsAt: 'release', writtenOctaves,
  drawing: {
    type: 'line', line: 'dashed', start: { kind: 'glyph', glyph }, end: { kind: 'hook', toward: 'staff' },
    continuation: { kind: 'glyph', glyph: continued, parenthesize: true }
  },
  side, baseline: 'ottava', layer: 7, sizes: ['full'], playback: 'none', inference: 'ottavas',
  examples: [{ score: example }]
}) as const;

export const LINES = [
  {
    id: 'pedal.ped-text', family: 'pedal', name: 'Sustain pedal (Ped. … ✱)',
    summary: 'Ped. where the pedal goes down, ✱ where it comes up, below the lower staff.',
    spec: '5.15', model: 'spanner', anchor: 'event', endsAt: 'onset',
    drawing: { type: 'line', line: 'none', start: { kind: 'glyph', glyph: 'keyboardPedalPed' }, end: { kind: 'glyph', glyph: 'keyboardPedalUp' } },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'sustain', inference: 'pedal',
    examples: [{ score: `${PEDAL_MUSIC}lower: C3/2[+pedal.ped-text] G3/2 | F3/2[-pedal.ped-text +pedal.ped-text] C4/2 | G2/1[-pedal.ped-text] |` }]
  },
  {
    id: 'pedal.bracket', family: 'pedal', name: 'Sustain pedal bracket',
    summary: 'A line under the music with hooks where the pedal goes down and up.',
    spec: '5.15', model: 'spanner', anchor: 'event', endsAt: 'onset',
    drawing: { type: 'line', line: 'solid', start: { kind: 'hook', toward: 'staff' }, end: { kind: 'hook', toward: 'staff' } },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'sustain', inference: 'pedal',
    examples: [
      { score: `${PEDAL_MUSIC}lower: C3/2[+pedal.bracket] G3/2 | F3/2[pedal.change] C4/2 | G2/1[-pedal.bracket] |` },
      { title: 'Across a line break', score: 'upper: C5/1 | D5/1 | E5/1 | F5/1 |\nlower: C3/1[+pedal.bracket] | C3/1 | C3/1 | C3/1[-pedal.bracket] |', width: 26 }
    ]
  },
  {
    id: 'pedal.change', family: 'pedal', name: 'Pedal change',
    summary: 'A notch in a pedal bracket: release and press again at once.',
    spec: '5.15', model: 'attachment', anchor: 'event', drawing: { type: 'structure' },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'sustain', inference: 'pedal',
    examples: [{ score: `${PEDAL_MUSIC}lower: C3/2[+pedal.bracket] G3/2[pedal.change] | F3/2[pedal.change] C4/2[pedal.change] | G2/1[-pedal.bracket] |` }]
  },
  {
    id: 'pedal.half', family: 'pedal', name: 'Half pedal',
    summary: 'Press the pedal only partly. Reserved.',
    spec: '5.15', model: 'attachment', anchor: 'event', drawing: { type: 'glyph', above: 'keyboardPedalHalf', align: 'event' },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'sustain',
    examples: [{ score: 'upper: E5/1 |\nlower: C3/1[pedal.half] |' }]
  },
  {
    id: 'pedal.una-corda', family: 'pedal', name: 'Una corda / tre corde', aliases: ['soft pedal', 'u.c.'],
    summary: 'Soft pedal down (una corda) until tre corde.',
    spec: '5.15', model: 'spanner', anchor: 'event', endsAt: 'onset',
    drawing: { type: 'line', line: 'none', start: { kind: 'text', style: 'technique', default: 'una corda' }, end: { kind: 'text', style: 'technique', default: 'tre corde' } },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'none',
    examples: [{ score: `${PEDAL_MUSIC}lower: C3/1[+pedal.una-corda] | F3/1 | G2/1[-pedal.una-corda] |` }]
  },
  {
    id: 'pedal.sostenuto', family: 'pedal', name: 'Sostenuto pedal', aliases: ['Sost. Ped.'],
    summary: 'The middle pedal: sustains only the notes held when it goes down.',
    spec: '5.15', model: 'spanner', anchor: 'event', endsAt: 'onset',
    drawing: { type: 'line', line: 'none', start: { kind: 'glyph', glyph: 'keyboardPedalSost' }, end: { kind: 'glyph', glyph: 'keyboardPedalUp' } },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'sustain',
    examples: [{ score: `${PEDAL_MUSIC}lower: C2/1[+pedal.sostenuto] | F3/1 | G2/1[-pedal.sostenuto] |` }]
  },
  {
    id: 'pedal.simile', family: 'pedal', name: 'simile',
    summary: 'Continue in the same way; later identical pedal patterns are not drawn.',
    pending: 'The word is drawn, but later identical pedal patterns are still drawn too.',
    spec: '5.15', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'expression', align: 'event-left', default: 'simile' },
    side: 'below', baseline: 'pedal', layer: 7, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: E5/1 | F5/1 | G5/1 | A5/1 |\nlower: C3/2[+pedal.ped-text] G3[-pedal.ped-text] | F3/2[+pedal.ped-text pedal.simile] C4[-pedal.ped-text] | G2/2[+pedal.ped-text] D3[-pedal.ped-text] | A2/2[+pedal.ped-text] E3[-pedal.ped-text] |' }]
  },
  ottava('ottava.8va', '8va', 'ottavaAlta', 'ottava', 'above', -1, 'Play an octave higher than written.',
    `${TREBLE}upper: C6/4[+ottava.8va] E6 G6 C7 | B6/2 G6/2[-ottava.8va] | C6/1 |`),
  ottava('ottava.8vb', '8vb', 'ottavaBassaVb', 'ottava', 'below', 1, 'Play an octave lower than written.',
    'staves: lower bass\nlower: C2/4[+ottava.8vb] A1 F1 C1 | E1/2 G1/2[-ottava.8vb] | C2/1 |'),
  ottava('ottava.15ma', '15ma', 'quindicesimaAlta', 'quindicesima', 'above', -2, 'Play two octaves higher than written.',
    `${TREBLE}upper: C7/4[+ottava.15ma] E7 G7 C8[-ottava.15ma] |`),
  ottava('ottava.15mb', '15mb', 'quindicesimaBassaMb', 'quindicesima', 'below', 2, 'Play two octaves lower than written.',
    'staves: lower bass\nlower: C1/4[+ottava.15mb] A0 G0 C1[-ottava.15mb] |'),
  {
    id: 'ottava.loco', family: 'ottava', name: 'loco',
    summary: 'Back at written pitch, after an octave line.',
    spec: '5.16', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'expression', align: 'event-left', default: 'loco' },
    side: 'above', layer: 7, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C6/4[+ottava.8va] E6 G6 C7[-ottava.8va] | C6/1[ottava.loco] |` }]
  },
  {
    id: 'tempo.text', family: 'tempo', name: 'Tempo marking', aliases: ['Allegro', 'Largo', 'Presto'],
    summary: 'Tempo words above the system, in bold.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'tempo', align: 'event-left' },
    side: 'system', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/1[tempo.text="Allegro agitato"] | E5/1 | key=-5 Db5/1[tempo.text="Moderato cantabile"] |\nlower: C3/1 | C3/1 | Db3/1 |' }]
  },
  {
    id: 'tempo.metronome', family: 'tempo', name: 'Metronome mark',
    summary: 'Note value = beats per minute, beside or instead of tempo words.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'tempo', align: 'event-left', content: 'metronome' },
    side: 'system', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1[tempo.text="Allegro agitato" tempo.metronome unit=half bpm=84] | E5/1[tempo.metronome unit=dotted-quarter bpm=60] |` }]
  },
  {
    id: 'tempo.change', family: 'tempo', name: 'Gradual tempo change', aliases: ['rit.', 'rall.', 'accel.', 'string.', 'allarg.'],
    summary: 'rit., accel. and the like, with a dashed line over their extent.',
    spec: '5.17', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: { type: 'line', line: 'dashed', start: { kind: 'text', style: 'expression', default: 'rit.' }, extent: 'duration' },
    side: 'above', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'none', inference: 'tempo',
    examples: [{ score: `${TREBLE}upper: C5/4 D5[+tempo.change="rit."] E5 F5 | G5/1[-tempo.change] | A5/4[tempo.return="a tempo"] B5 C6/2 |` }]
  },
  {
    id: 'tempo.return', family: 'tempo', name: 'a tempo / Tempo I',
    summary: 'Back to the tempo before a change.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'expression', align: 'event-left', default: 'a tempo' },
    side: 'above', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'none', inference: 'tempo',
    examples: [{ score: `${TREBLE}upper: G5/1 | A5/4[tempo.return] B5 C6/2 | D6/1[tempo.return="Tempo I"] |` }]
  },
  {
    id: 'expr.text', family: 'expr', name: 'Expression text', aliases: ['dolce', 'cantabile', 'agitato', 'sotto voce', 'espressivo'],
    summary: 'Italic words about character, placed with the dynamics.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'expression', align: 'event-left' },
    side: 'between-staves', baseline: 'dynamics', layer: 7, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/2[dyn.p expr.text="dolce"] E5/2 | G5/1[^expr.text="cantabile"] |\nlower: C3/1 | C3/1 |' }]
  },
  {
    id: 'expr.breath', family: 'expr', name: 'Breath mark',
    summary: 'A comma above the staff after a note: a short break.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'glyph', above: 'breathMarkComma', align: 'event-right' },
    side: 'above', layer: 4, sizes: ['full'], playback: 'extend-to-next-attack',
    examples: [{ score: `${TREBLE}upper: C5/4 D5 E5/2[expr.breath] | F5/1 |` }]
  },
  {
    id: 'expr.caesura', family: 'expr', name: 'Caesura', aliases: ['railroad tracks', '//'],
    summary: 'Two slashes through the top of the staff: a complete break.',
    spec: '5.17', model: 'attachment', anchor: 'event', drawing: { type: 'glyph', above: 'caesura', align: 'after' },
    side: 'through', layer: 4, sizes: ['full'], playback: 'extend-to-next-attack',
    examples: [{ score: `${TREBLE}upper: C5/4 D5 E5/2[expr.caesura] | F5/1 |` }]
  },
  {
    id: 'finger.number', family: 'finger', name: 'Fingering',
    summary: 'Finger numbers 1–5: above on the upper staff, below on the lower one.',
    spec: '5.19', model: 'attachment', anchor: 'note',
    drawing: {
      type: 'glyph', above: 'fingering1', align: 'event',
      variants: { param: 'finger', above: { '0': 'fingering0', '1': 'fingering1', '2': 'fingering2', '3': 'fingering3', '4': 'fingering4', '5': 'fingering5' } }
    },
    side: 'outer', layer: 4, sizes: ['small-text'], playback: 'none',
    examples: [{ score: 'upper: C5/4[finger.number finger=1] D5[finger.number finger=2] E5[finger.number finger=3] <C5 E5 G5>[finger.number finger=1 finger.number finger=3 finger.number finger=5] |\nlower: C3/4[finger.number finger=5] E3[finger.number finger=3] G3[finger.number finger=1] C3/4 |' }]
  },
  {
    id: 'finger.substitution', family: 'finger', name: 'Finger substitution',
    summary: 'Change finger on a held note, e.g. 4–5.',
    spec: '5.19', model: 'attachment', anchor: 'note', drawing: { type: 'text', style: 'small', align: 'event' },
    side: 'outer', layer: 4, sizes: ['small-text'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/2[finger.substitution="4–5"] D5/2 |` }]
  },
  {
    id: 'finger.hand', family: 'finger', name: 'Hand indication', aliases: ['m.d.', 'm.s.', 'r.h.', 'l.h.'],
    summary: 'Which hand plays, where a hand crosses to the other staff.',
    spec: '5.19', model: 'attachment', anchor: 'event', drawing: { type: 'text', style: 'technique', align: 'event-left', default: 'm.d.' },
    side: 'above', layer: 4, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/2 E5 | r/1 |\nlower: C3/2 G3 | E4/2[finger.hand="m.s."] G4 |' }]
  }
] as const satisfies readonly CatalogueEntry[];
