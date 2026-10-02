import type { CatalogueEntry } from '../types';

const dynamic = <const Id extends string>(id: Id, name: string, glyph: string, summary: string) => ({
  id, family: 'dyn', name, summary, spec: '5.14', model: 'attachment', anchor: 'event',
  drawing: { type: 'glyph', above: glyph, align: 'event' }, side: 'between-staves', baseline: 'dynamics',
  layer: 7, sizes: ['full'], playback: 'none', inference: 'dynamics',
  examples: [{ score: `upper: C5/2[${id}] E5/2 |\nlower: C3/1 |` }]
}) as const;

export const DYNAMICS = [
  dynamic('dyn.pppp', 'pppp', 'dynamicPPPP', 'Pianississississimo: as soft as possible.'),
  dynamic('dyn.ppp', 'ppp', 'dynamicPPP', 'Pianississimo: extremely soft.'),
  dynamic('dyn.pp', 'pp', 'dynamicPP', 'Pianissimo: very soft.'),
  dynamic('dyn.p', 'p', 'dynamicPiano', 'Piano: soft.'),
  dynamic('dyn.mp', 'mp', 'dynamicMP', 'Mezzo-piano: moderately soft.'),
  dynamic('dyn.mf', 'mf', 'dynamicMF', 'Mezzo-forte: moderately loud.'),
  dynamic('dyn.f', 'f', 'dynamicForte', 'Forte: loud.'),
  dynamic('dyn.ff', 'ff', 'dynamicFF', 'Fortissimo: very loud.'),
  dynamic('dyn.fff', 'fff', 'dynamicFFF', 'Fortississimo: extremely loud.'),
  dynamic('dyn.ffff', 'ffff', 'dynamicFFFF', 'Fortissississimo: as loud as possible.'),
  dynamic('dyn.sf', 'sf', 'dynamicSforzando1', 'Sforzando: a sudden strong accent on one note.'),
  dynamic('dyn.sfz', 'sfz', 'dynamicSforzato', 'Sforzato: a sudden strong accent.'),
  dynamic('dyn.sffz', 'sffz', 'dynamicSforzatoFF', 'A very strong sforzato.'),
  dynamic('dyn.fz', 'fz', 'dynamicForzando', 'Forzando: forced, accented.'),
  dynamic('dyn.rf', 'rf', 'dynamicRinforzando1', 'Rinforzando: reinforced over a few notes.'),
  dynamic('dyn.rfz', 'rfz', 'dynamicRinforzando2', 'Rinforzando, written rfz.'),
  dynamic('dyn.fp', 'fp', 'dynamicFortePiano', 'Forte, then immediately piano.'),
  dynamic('dyn.sfp', 'sfp', 'dynamicSforzandoPiano', 'Sforzando, then immediately piano.'),
  {
    id: 'dyn.hairpin-cresc', family: 'dyn', name: 'Crescendo hairpin', aliases: ['<'],
    summary: 'Opening wedge: get louder. Ends at the last note or just before the next dynamic.',
    spec: '5.14', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: { type: 'line', line: 'hairpin-open', extent: 'duration' }, side: 'between-staves', baseline: 'dynamics',
    layer: 7, sizes: ['full'], playback: 'none', inference: 'dynamics',
    examples: [
      { score: 'upper: C5/4[dyn.p +dyn.hairpin-cresc] D5 E5 F5 | G5/1[-dyn.hairpin-cresc dyn.f] |\nlower: C3/1 | G2/1 |' },
      { title: 'Across a line break', score: 'upper: C5/1[dyn.pp] | D5/1[+dyn.hairpin-cresc] | E5/1 | F5/1 | G5/1[-dyn.hairpin-cresc dyn.ff] |\nlower: C3/1 | C3/1 | C3/1 | C3/1 | C3/1 |', width: 30 }
    ]
  },
  {
    id: 'dyn.hairpin-dim', family: 'dyn', name: 'Diminuendo hairpin', aliases: ['>', 'decrescendo hairpin'],
    summary: 'Closing wedge: get softer.',
    spec: '5.14', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: { type: 'line', line: 'hairpin-close', extent: 'duration' }, side: 'between-staves', baseline: 'dynamics',
    layer: 7, sizes: ['full'], playback: 'none', inference: 'dynamics',
    examples: [{ score: 'upper: G5/4[dyn.f +dyn.hairpin-dim] F5 E5 D5 | C5/1[-dyn.hairpin-dim dyn.p] |\nlower: C3/1 | C3/1 |' }]
  },
  {
    id: 'dyn.text-cresc', family: 'dyn', name: 'cresc.',
    summary: 'Crescendo in words, with a dashed line to its end; reprinted as (cresc.) after a break.',
    spec: '5.14', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: {
      type: 'line', line: 'dashed', start: { kind: 'text', style: 'expression', default: 'cresc.' },
      continuation: { kind: 'text', style: 'expression', default: 'cresc.', parenthesize: true }, extent: 'duration'
    },
    side: 'between-staves', baseline: 'dynamics', layer: 7, sizes: ['full'], playback: 'none', inference: 'dynamics',
    examples: [{ score: 'upper: C5/4[dyn.p +dyn.text-cresc] D5 E5 F5 | G5/2 A5 | B5/1[-dyn.text-cresc dyn.f] |\nlower: C3/1 | C3/1 | C3/1 |' }]
  },
  {
    id: 'dyn.text-dim', family: 'dyn', name: 'dim. / decresc.',
    summary: 'Diminuendo in words, with a dashed line to its end.',
    spec: '5.14', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: {
      type: 'line', line: 'dashed', start: { kind: 'text', style: 'expression', default: 'dim.' },
      continuation: { kind: 'text', style: 'expression', default: 'dim.', parenthesize: true }, extent: 'duration'
    },
    side: 'between-staves', baseline: 'dynamics', layer: 7, sizes: ['full'], playback: 'none', inference: 'dynamics',
    examples: [{ score: 'upper: G5/4[dyn.f +dyn.text-dim] F5 E5 D5 | C5/1[-dyn.text-dim dyn.pp] |\nlower: C3/1 | C3/1 |' }]
  },
  {
    id: 'dyn.modifier', family: 'dyn', name: 'Dynamic words',
    aliases: ['subito', 'più', 'meno', 'poco a poco', 'molto', 'sempre'],
    summary: 'Words that qualify a dynamic, set beside it in italics.',
    spec: '5.14', model: 'attachment', anchor: 'event',
    drawing: { type: 'text', style: 'expression', align: 'event-left' }, side: 'between-staves', baseline: 'dynamics',
    layer: 7, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/2[dyn.p dyn.modifier="subito"] E5/2 | G5/1[dyn.f dyn.modifier="sempre"] |\nlower: C3/1 | C3/1 |' }]
  }
] as const satisfies readonly CatalogueEntry[];
