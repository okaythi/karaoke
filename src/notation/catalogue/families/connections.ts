import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

export const CONNECTIONS = [
  {
    id: 'tie', family: 'tie', name: 'Tie',
    summary: 'Joins two notes of the same pitch into one sound; curves away from the stem.',
    spec: '5.10', model: 'spanner', anchor: 'note', endsAt: 'release', drawing: { type: 'curve', curve: 'tie' },
    layer: 3, sizes: ['full', 'grace', 'cue'], playback: 'tie', inference: 'rhythm',
    examples: [
      { score: `${TREBLE}upper: C5/2~ C5/4 E5/4~ | E5/2 <C5 E5 G5>/2~ | <C5 E5 G5>/1 |` },
      { title: 'Across a line break', score: `${TREBLE}upper: G4/1 | A4/1 | B4/1~ | B4/1 | C5/1 |`, width: 30 }
    ]
  },
  {
    id: 'tie.lv', family: 'tie', name: 'Laissez-vibrer tie', aliases: ['let ring'],
    summary: 'A short open tie: let the note ring.',
    spec: '5.10', model: 'attachment', anchor: 'note', drawing: { type: 'curve', curve: 'laissez-vibrer' },
    layer: 3, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: <C5 E5>/4[tie.lv] r/4 G4/4[tie.lv] r/4 |` }]
  },
  {
    id: 'slur', family: 'slur', name: 'Slur',
    summary: 'Curve over notes played legato; ends on noteheads, or stem tips on the stem side.',
    spec: '5.10', model: 'spanner', anchor: 'event', endsAt: 'release', drawing: { type: 'curve', curve: 'slur' },
    layer: 3, sizes: ['full', 'grace'], playback: 'none',
    examples: [
      { score: `${TREBLE}upper: C5/8[+slur] D5 E5 F5 G5/4[-slur] E5/4[+slur] | D5/4 B4 C5/2[-slur] |` },
      { title: 'With staccato inside', score: `${TREBLE}upper: G4/4[+slur artic.staccato] A4[artic.staccato] B4[artic.staccato] C5[-slur artic.staccato] |` },
      { title: 'Across a line break', score: `${TREBLE}upper: G4/2[+slur] A4 | B4/1 | C5/2 D5[-slur] | E5/1 |`, width: 28 }
    ]
  },
  {
    id: 'slur.phrasing', family: 'slur', name: 'Phrasing slur',
    summary: 'A long slur over a phrase, drawn outside the shorter slurs it contains.',
    spec: '5.10', model: 'spanner', anchor: 'event', endsAt: 'release', drawing: { type: 'curve', curve: 'phrasing' },
    layer: 3, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/4[+slur.phrasing +slur] D5[-slur] E5[+slur] F5[-slur] | G5/4[+slur] F5 E5 D5[-slur -slur.phrasing] |` }]
  },
  {
    id: 'gliss', family: 'gliss', name: 'Glissando',
    summary: 'A line from one notehead to the next: slide through the notes between.',
    spec: '5.10', model: 'spanner', anchor: 'note', endsAt: 'onset', drawing: { type: 'line', line: 'wiggle' },
    layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C4/2[+gliss] C6/2[-gliss] |` }]
  }
] as const satisfies readonly CatalogueEntry[];
