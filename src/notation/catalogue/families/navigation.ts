import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

export const NAVIGATION = [
  {
    id: 'nav.repeat-start', family: 'nav', name: 'Start repeat',
    summary: 'Thick, thin and two dots: the repeated passage starts here.',
    spec: '5.18', model: 'structure', drawing: { type: 'structure', glyphs: ['repeatDots'] }, layer: 0, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/1 |: D5/1 | E5/1 :| F5/1 |` }]
  },
  {
    id: 'nav.repeat-end', family: 'nav', name: 'End repeat',
    summary: 'Two dots, thin and thick: go back to the start repeat (or the beginning).',
    spec: '5.18', model: 'structure', drawing: { type: 'structure', glyphs: ['repeatDots'] }, layer: 0, sizes: ['full'], playback: 'navigation',
    examples: [{ score: 'upper: C5/2 D5 | E5/1 :| F5/1 |final\nlower: C3/1 | C3/1 :| F2/1 |final' }]
  },
  {
    id: 'nav.repeat-both', family: 'nav', name: 'End and start repeat',
    summary: 'Two repeated passages back to back.',
    spec: '5.18', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/1 |: D5/1 :|: E5/1 :| F5/1 |` }]
  },
  {
    id: 'nav.volta', family: 'nav', name: 'Volta', aliases: ['1st and 2nd ending', 'first and second time bar'],
    summary: 'Bracket over the bars played on a given pass through a repeat.',
    spec: '5.18', model: 'spanner', anchor: 'barline', endsAt: 'release',
    drawing: { type: 'line', line: 'solid', start: { kind: 'hook', toward: 'staff' }, end: { kind: 'hook', toward: 'staff' }, label: 'tempo' },
    side: 'system', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: |: C5/1 | [+nav.volta="1."] D5/1 :| [-nav.volta +nav.volta="2." open=true] E5/1 | [-nav.volta] F5/1 |final` }]
  },
  {
    id: 'nav.segno', family: 'nav', name: 'Segno',
    summary: 'The sign D.S. returns to.',
    spec: '5.18', model: 'attachment', anchor: 'barline', drawing: { type: 'glyph', above: 'segno', align: 'barline' },
    side: 'system', layer: 8, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/1 | [nav.segno] D5/1 | E5/1 | [nav.jump="D.S. al Fine"] F5/1 |final` }]
  },
  {
    id: 'nav.coda', family: 'nav', name: 'Coda',
    summary: 'The sign marking the coda, and where to jump to it.',
    spec: '5.18', model: 'attachment', anchor: 'barline', drawing: { type: 'glyph', above: 'coda', align: 'barline' },
    side: 'system', layer: 8, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/1 | D5/1 [nav.jump="To Coda"] | E5/1 |double [nav.coda] F5/1 |final` }]
  },
  {
    id: 'nav.jump', family: 'nav', name: 'Jump', aliases: ['D.C.', 'D.S.', 'al Fine', 'al Coda', 'Fine', 'To Coda'],
    summary: 'Instructions to jump, right-aligned at their barline.',
    spec: '5.18', model: 'attachment', anchor: 'barline', drawing: { type: 'text', style: 'navigation', align: 'before-barline' },
    side: 'below', layer: 8, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/1 | D5/1 [^nav.jump="Fine"] |final E5/1 | F5/1 [nav.jump="D.C. al Fine"] |final` }]
  },
  {
    id: 'nav.rehearsal', family: 'nav', name: 'Rehearsal mark',
    summary: 'A boxed letter or number above the system at a barline.',
    spec: '5.18', model: 'attachment', anchor: 'barline', drawing: { type: 'text', style: 'rehearsal', align: 'barline', enclosure: 'box' },
    side: 'system', baseline: 'tempo', layer: 8, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/1 |double [nav.rehearsal="A"] D5/1 | E5/1 |double [nav.rehearsal="B"] F5/1 |\nlower: C3/1 |double D3/1 | E3/1 |double F3/1 |' }]
  },
  {
    id: 'nav.bar-repeat', family: 'nav', name: 'Bar repeat', aliases: ['simile bar', '%'],
    summary: 'Play the previous bar again.',
    spec: '5.18', model: 'attachment', anchor: 'barline', drawing: { type: 'glyph', above: 'repeat1Bar', align: 'measure' },
    side: 'through', layer: 0, sizes: ['full'], playback: 'navigation',
    examples: [{ score: `${TREBLE}upper: C5/8 E5 G5 C6 G5 E5 C5/4 | [nav.bar-repeat] s/1 | D5/1 |` }]
  }
] as const satisfies readonly CatalogueEntry[];
