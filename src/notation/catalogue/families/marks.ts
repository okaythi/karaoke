import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

/** A mark on the notehead side that may sit inside the staff (layer 1). */
const articulation = <const Id extends string>(id: Id, name: string, glyph: string, summary: string, example: string, layer: 1 | 2 = 1) => ({
  id, family: 'artic', name, summary, spec: '5.11', model: 'attachment', anchor: 'event',
  drawing: { type: 'glyph', above: `${glyph}Above`, below: `${glyph}Below`, align: 'event', inside: layer === 1 },
  side: 'notehead', layer, sizes: ['full', 'grace', 'cue'], playback: 'none', inference: 'articulations',
  examples: [{ score: `${TREBLE}${example}` }, { title: 'Two voices', score: `${TREBLE}upper: E5/4[${id}] F5[${id}] G5/2[${id}] |\nupper.2: C5/4[${id}] B4[${id}] A4/2[${id}] |` }]
}) as const;

const ornament = <const Id extends string>(id: Id, name: string, glyph: string, summary: string, example: string, aliases: readonly string[] = []) => ({
  id, family: 'orn', name, aliases, summary, spec: '5.12', model: 'attachment', anchor: 'event',
  drawing: { type: 'glyph', above: glyph, align: 'event' }, side: 'voice', layer: 4, sizes: ['full'],
  playback: 'linked-performance', inference: 'ornaments', examples: [{ score: `${TREBLE}${example}` }]
}) as const;

export const MARKS = [
  articulation('artic.staccato', 'Staccato', 'articStaccato', 'Short and detached; the dot nearest the notehead.',
    'upper: C5/4[artic.staccato] A4[artic.staccato] <E4 G4 C5>[artic.staccato] B5[artic.staccato] |'),
  articulation('artic.staccatissimo', 'Staccatissimo', 'articStaccatissimoWedge', 'Very short: a wedge.',
    'upper: C5/4[artic.staccatissimo] A4[artic.staccatissimo] F5[artic.staccatissimo] r/4 |'),
  articulation('artic.tenuto', 'Tenuto', 'articTenuto', 'Held for its full value; a short line.',
    'upper: C5/4[artic.tenuto] A4[artic.tenuto] F5[artic.tenuto] r/4 |'),
  articulation('artic.portato', 'Portato', 'articTenutoStaccato', 'Tenuto and staccato together: lightly separated.',
    'upper: C5/4[artic.portato] D5[artic.portato] E5[artic.portato] F5[artic.portato] |'),
  articulation('artic.accent', 'Accent', 'articAccent', 'Played with emphasis: >.',
    'upper: C5/4[artic.accent] A4[artic.accent artic.staccato] F5/2[artic.accent] |', 2),
  {
    id: 'artic.marcato', family: 'artic', name: 'Marcato', aliases: ['strong accent', '^'],
    summary: 'A strong accent; always above the staff (below for a second voice).',
    spec: '5.11', model: 'attachment', anchor: 'event',
    drawing: { type: 'glyph', above: 'articMarcatoAbove', below: 'articMarcatoBelow', align: 'event' },
    side: 'voice', layer: 4, sizes: ['full'], playback: 'none', inference: 'articulations',
    examples: [{ score: `${TREBLE}upper: C5/4[artic.marcato] A4[artic.marcato artic.staccato] F4/2[artic.marcato] |` }]
  },
  {
    id: 'artic.fermata', family: 'artic', name: 'Fermata', aliases: ['pause', 'bird’s eye'],
    summary: 'Hold longer than written. Short, normal and long shapes; outermost of the note marks.',
    spec: '5.11', model: 'attachment', anchor: 'event',
    drawing: {
      type: 'glyph', above: 'fermataAbove', below: 'fermataBelow', align: 'event',
      variants: {
        param: 'length',
        above: { short: 'fermataShortAbove', normal: 'fermataAbove', long: 'fermataLongAbove' },
        below: { short: 'fermataShortBelow', normal: 'fermataBelow', long: 'fermataLongBelow' }
      }
    },
    side: 'voice', layer: 5, sizes: ['full'], playback: 'extend-to-next-attack',
    examples: [
      { score: `${TREBLE}upper: C5/2[artic.fermata] r/2[artic.fermata] | E5/4[artic.fermata length=short] G5[artic.fermata length=long] C6/2[artic.fermata artic.accent] |` },
      { title: 'Two voices', score: `${TREBLE}upper: G5/1[artic.fermata] |\nupper.2: C5/1[artic.fermata] |` }
    ]
  },
  {
    id: 'artic.fermata-barline', family: 'artic', name: 'Fermata over a barline',
    summary: 'A pause between sections, centred over the barline.',
    spec: '5.11', model: 'attachment', anchor: 'barline',
    drawing: { type: 'glyph', above: 'fermataAbove', align: 'barline' },
    side: 'system', layer: 5, sizes: ['full'], playback: 'extend-to-next-attack',
    examples: [{ score: `${TREBLE}upper: C5/2 D5 | [artic.fermata-barline] E5/1 |` }]
  },
  {
    id: 'orn.trill', family: 'orn', name: 'Trill', aliases: ['tr'],
    summary: 'Rapid alternation with the note above; tr above the note.',
    spec: '5.12', model: 'attachment', anchor: 'event', drawing: { type: 'glyph', above: 'ornamentTrill', align: 'event' },
    side: 'voice', layer: 4, sizes: ['full'], playback: 'linked-performance', inference: 'ornaments',
    examples: [{ score: `${TREBLE}upper: D5/4[orn.trill] C5 B4/2[orn.trill] |` }]
  },
  {
    id: 'orn.trill-line', family: 'orn', name: 'Trill extension line', aliases: ['horizontal wavy line'],
    summary: 'tr followed by a wavy line for the length of the trill.',
    spec: '5.12', model: 'spanner', anchor: 'event', endsAt: 'release',
    drawing: { type: 'line', line: 'wiggle', start: { kind: 'glyph', glyph: 'ornamentTrill' }, extent: 'duration' },
    side: 'voice', layer: 7, sizes: ['full'], playback: 'linked-performance', inference: 'ornaments',
    examples: [
      { score: `${TREBLE}upper: E5/1[+orn.trill-line -orn.trill-line] | D5/2[+orn.trill-line] D5/2[-orn.trill-line] |` },
      { title: 'Across a line break', score: `${TREBLE}upper: G4/1 | A4/1 | B4/1[+orn.trill-line] | B4/1[-orn.trill-line] | C5/1 |`, width: 30 }
    ]
  },
  ornament('orn.mordent', 'Mordent', 'ornamentMordent', 'Main note, the note below, main note.',
    'upper: C5/4[orn.mordent] E5 G5/2[orn.mordent] |', ['lower mordent']),
  ornament('orn.inverted-mordent', 'Inverted mordent', 'ornamentShortTrill', 'Main note, the note above, main note.',
    'upper: C5/4[orn.inverted-mordent] E5 G5/2[orn.inverted-mordent] |', ['upper mordent', 'Pralltriller']),
  ornament('orn.turn', 'Turn', 'ornamentTurn', 'Upper note, main note, lower note, main note.',
    'upper: C5/4[orn.turn] E5 G5/2[orn.turn] |', ['gruppetto']),
  ornament('orn.inverted-turn', 'Inverted turn', 'ornamentTurnInverted', 'Lower note, main note, upper note, main note.',
    'upper: C5/4[orn.inverted-turn] E5 G5/2[orn.inverted-turn] |'),
  {
    id: 'orn.turn-after', family: 'orn', name: 'Turn after a note',
    summary: 'A turn written between two notes: played at the end of the first.',
    spec: '5.12', model: 'attachment', anchor: 'event', drawing: { type: 'glyph', above: 'ornamentTurn', align: 'after' },
    side: 'voice', layer: 4, sizes: ['full'], playback: 'linked-performance', inference: 'ornaments',
    examples: [{ score: `${TREBLE}upper: C5/2[orn.turn-after] D5/2 |` }]
  },
  {
    id: 'orn.accidental', family: 'orn', name: 'Ornament accidental',
    summary: 'A small accidental above or below an ornament for its upper or lower note.',
    spec: '5.12', model: 'attachment', anchor: 'event',
    drawing: {
      type: 'glyph', above: 'accidentalSharp', align: 'event',
      variants: { param: 'alter', above: { '2': 'accidentalDoubleSharp', '1': 'accidentalSharp', '0': 'accidentalNatural', '-1': 'accidentalFlat', '-2': 'accidentalDoubleFlat' } }
    },
    side: 'voice', layer: 4, sizes: ['small-text'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/2[orn.turn orn.accidental alter=-1] E5/2[orn.trill orn.accidental alter=1] |` }]
  },
  {
    id: 'orn.tremolo', family: 'orn', name: 'Tremolo', aliases: ['single-note tremolo'],
    summary: 'Strokes across the stem: repeat the note rapidly.',
    spec: '5.12', model: 'attachment', anchor: 'event',
    drawing: {
      type: 'glyph', above: 'tremolo3', align: 'stem',
      variants: { param: 'strokes', above: { '1': 'tremolo1', '2': 'tremolo2', '3': 'tremolo3', '4': 'tremolo4' } }
    },
    layer: 0, sizes: ['full'], playback: 'linked-performance', inference: 'ornaments',
    examples: [{ score: `${TREBLE}upper: C5/4[orn.tremolo strokes=1] C5[orn.tremolo strokes=2] A4/2[orn.tremolo] | E5/1[orn.tremolo] |` }]
  },
  {
    id: 'orn.tremolo-between', family: 'orn', name: 'Two-note tremolo', aliases: ['alternating tremolo'],
    summary: 'Beams between two notes: alternate them rapidly; each is written with the full duration.',
    spec: '5.12', model: 'spanner', anchor: 'event', endsAt: 'release', drawing: { type: 'structure' },
    layer: 0, sizes: ['full'], playback: 'linked-performance', inference: 'ornaments',
    examples: [{ score: `${TREBLE}upper: C5/2[+orn.tremolo-between strokes=3] E5/2[-orn.tremolo-between] |` }]
  },
  {
    id: 'arp.plain', family: 'arp', name: 'Arpeggio', aliases: ['vertical wavy line', 'rolled chord'],
    summary: 'A wavy line left of a chord: roll the notes from the bottom.',
    spec: '5.13', model: 'attachment', anchor: 'event', drawing: { type: 'vertical', segment: 'wiggleArpeggiatoUp' },
    layer: 0, sizes: ['full'], playback: 'roll', inference: 'arpeggios',
    examples: [{ score: `${TREBLE}upper: <C4 E4 G4 C5>/2[arp.plain] <D4 F#4 A4 D5 F#5>/2[arp.plain] |` }]
  },
  {
    id: 'arp.up', family: 'arp', name: 'Arpeggio upward',
    summary: 'Arpeggio with an arrow pointing up.',
    spec: '5.13', model: 'attachment', anchor: 'event',
    drawing: { type: 'vertical', segment: 'wiggleArpeggiatoUp', cap: { up: 'wiggleArpeggiatoUpArrow' } },
    layer: 0, sizes: ['full'], playback: 'roll', inference: 'arpeggios',
    examples: [{ score: `${TREBLE}upper: <C4 E4 G4 C5>/1[arp.up] |` }]
  },
  {
    id: 'arp.down', family: 'arp', name: 'Arpeggio downward',
    summary: 'Arpeggio with an arrow pointing down: roll from the top.',
    spec: '5.13', model: 'attachment', anchor: 'event',
    drawing: { type: 'vertical', segment: 'wiggleArpeggiatoDown', cap: { down: 'wiggleArpeggiatoDownArrow' } },
    layer: 0, sizes: ['full'], playback: 'roll', inference: 'arpeggios',
    examples: [{ score: `${TREBLE}upper: <C4 E4 G4 C5>/1[arp.down] |` }]
  },
  {
    id: 'arp.cross-staff', family: 'arp', name: 'Cross-staff arpeggio',
    summary: 'One arpeggio through both staves: roll the hands as one chord.',
    spec: '5.13', model: 'spanner', anchor: 'event', endsAt: 'onset', drawing: { type: 'vertical', segment: 'wiggleArpeggiatoUp' },
    layer: 0, sizes: ['full'], playback: 'roll', inference: 'arpeggios',
    examples: [{ score: 'upper: <E4 G4 C5>/1[-arp.cross-staff] |\nlower: <C3 G3 C4>/1[+arp.cross-staff] |' }]
  },
  {
    id: 'arp.non', family: 'arp', name: 'Non-arpeggio',
    summary: 'A square bracket left of a chord: play together, do not roll.',
    spec: '5.13', model: 'attachment', anchor: 'event', drawing: { type: 'vertical', segment: 'wiggleArpeggiatoUp', bracket: true },
    layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: <C4 E4 G4 C5>/1[arp.non] |` }]
  }
] as const satisfies readonly CatalogueEntry[];
