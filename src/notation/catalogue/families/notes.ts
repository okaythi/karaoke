import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

const rest = <const Id extends string>(id: Id, name: string, glyph: string, example: string) => ({
  id, family: 'rest', name, summary: `${name}: silence for the same value as the matching note.`, spec: '5.7',
  model: 'structure', drawing: { type: 'structure', glyphs: [glyph] }, layer: 0, sizes: ['full', 'cue'],
  playback: 'none', inference: 'rhythm', examples: [{ score: `${TREBLE}${example}` }]
}) as const;

const accidental = <const Id extends string>(id: Id, name: string, glyph: string, example: string) => ({
  id, family: 'acc', name, summary: `${name}, drawn when the accidental rule requires it.`, spec: '5.8',
  model: 'structure', drawing: { type: 'structure', glyphs: [glyph] }, layer: 0, sizes: ['full', 'grace', 'cue'],
  playback: 'none', inference: 'spelling', examples: [{ score: `${TREBLE}${example}` }]
}) as const;

export const NOTES = [
  {
    id: 'note.head', family: 'note', name: 'Noteheads',
    summary: 'Whole, half and black noteheads, placed on lines and spaces by pitch and clef.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure', glyphs: ['noteheadWhole', 'noteheadHalf', 'noteheadBlack', 'noteheadDoubleWhole'] },
    layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1 | D5/2 E5/4 F5/4 |` }]
  },
  {
    id: 'note.stem', family: 'note', name: 'Stems',
    summary: 'Direction by the stem rule; 3.5 spaces long, reaching the middle line from far ledger lines.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [
      { title: 'Direction by position', score: `${TREBLE}upper: E4/4 A4 B4 E5 | <C4 G5>/4 <E4 F5> A6 C3 |` },
      { title: 'Two voices', score: `${TREBLE}upper: E5/4 F5 G5 A5 |\nupper.2: C5/4 B4 A4 G4 |` }
    ]
  },
  {
    id: 'note.flag', family: 'note', name: 'Flags',
    summary: 'Eighth to 128th flags on unbeamed notes; stems lengthen for 32nds and shorter.',
    spec: '5.5', model: 'structure',
    drawing: { type: 'structure', glyphs: ['flag8thUp', 'flag8thDown', 'flag16thUp', 'flag16thDown', 'flag32ndUp', 'flag32ndDown', 'flag64thUp', 'flag64thDown', 'flag128thUp', 'flag128thDown'] },
    layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/8 r/8 A4/16 r/16 r/8 F5/32 r/32 r/16 r/8 G4/64 r/64 r/32 r/16 r/8 |` }]
  },
  {
    id: 'note.dot', family: 'note', name: 'Augmentation dots',
    summary: 'In the space right of the notehead (the space above for notes on a line); chord dots in one column.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure', glyphs: ['augmentationDot'] },
    layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [
      { score: `${TREBLE}upper: C5/4. D5/8 E5/2 | F5/2.. G5/8 |` },
      { title: 'Chord on lines and spaces', score: `${TREBLE}upper: <E4 G4 B4 C5>/2. r/4 |` }
    ]
  },
  {
    id: 'note.chord', family: 'note', name: 'Chords',
    summary: 'Several noteheads on one stem; seconds sit on opposite sides of the stem.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: <C4 E4 G4>/4 <F4 G4 A4> <C5 D5 E5 F5> <B4 C5>/4 |` }]
  },
  {
    id: 'note.beam', family: 'note', name: 'Beams',
    summary: 'Group short notes by beat; secondary beams show subdivisions; slant follows the outer notes.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    inference: 'beaming',
    examples: [
      { title: '4/4 eighths and sixteenths', score: `${TREBLE}upper: C5/8 D5 E5 F5 G5/16 F5 E5 D5 C5/8. D5/16 |` },
      { title: 'Broken beam', score: `${TREBLE}upper: C5/8. D5/16 E5/16 F5/8. G5/4 A5/4 |` },
      { title: '6/8', score: `${TREBLE}time: 6/8\nupper: C5/16 D5 E5 F5 G5 A5 B5/8 A5 G5 |` }
    ]
  },
  {
    id: 'note.cross-staff', family: 'note', name: 'Cross-staff notes',
    summary: 'Notes of one staff drawn on the other staff of the grand staff, keeping their voice and beam.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    inference: 'staves',
    examples: [{ score: 'upper: C5/16 G4 E4@lower C4@lower C5/16 G4 E4@lower C4@lower C5/2 |\nlower: C3/1 |' }]
  },
  {
    id: 'note.voices', family: 'note', name: 'Multiple voices',
    summary: 'Up to four voices on one staff: odd voices stem up, even voices stem down.',
    spec: '5.5', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    inference: 'voices',
    examples: [{ score: `${TREBLE}upper: G5/2 F5/4 E5 | D5/1 |\nupper.2: C5/8 D5 E5 C5 B4/2 | r/2 G4/2 |` }]
  },
  {
    id: 'grace.acciaccatura', family: 'grace', name: 'Acciaccatura', aliases: ['crushed grace note', 'slashed grace note'],
    summary: 'A small slashed note played as quickly as possible before the main note.',
    spec: '5.6', model: 'structure', drawing: { type: 'structure', glyphs: ['graceNoteSlashStemUp', 'graceNoteSlashStemDown'] },
    layer: 0, sizes: ['grace'], playback: 'grace', inference: 'graces',
    examples: [{ score: `${TREBLE}upper: acc{D5/8} C5/4 acc{F#5/8} G5/4 acc{B4/8} C5/2 |` }]
  },
  {
    id: 'grace.appoggiatura', family: 'grace', name: 'Appoggiatura',
    summary: 'A small unslashed note that takes its time from the main note.',
    spec: '5.6', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['grace'], playback: 'grace', inference: 'graces',
    examples: [{ score: `${TREBLE}upper: grace{D5/8} C5/2 grace{Bb4/16} A4/2 |` }]
  },
  {
    id: 'grace.group', family: 'grace', name: 'Grace-note group',
    summary: 'Several grace notes beamed together, with their own accidentals, before one main note.',
    spec: '5.6', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['grace'], playback: 'grace', inference: 'graces',
    examples: [{ score: `${TREBLE}upper: acc{C5/16 D5 E5} F5/2 grace{G#5/16 A5 B5 C6} D6/2 |` }]
  },
  {
    id: 'grace.after', family: 'grace', name: 'After-grace notes', aliases: ['Nachschlag', 'trill termination'],
    summary: 'Grace notes at the end of a note, leading into the next one.',
    spec: '5.6', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['grace'], playback: 'grace', inference: 'graces',
    examples: [{ score: `${TREBLE}upper: D5/2[+orn.trill-line -orn.trill-line] after{C#5/16 D5} E5/2 |` }]
  },
  {
    id: 'cue.note', family: 'cue', name: 'Cue notes',
    summary: 'Reduced-size notes showing another part. Reserved for multi-part scores.',
    spec: '5.6', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['cue'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: r/2 E5/8[size=cue] F5[size=cue] G5/4[size=cue] | C5/1 |` }]
  },
  rest('rest.whole', 'Whole rest', 'restWhole', 'upper: C5/2 D5 | r/1 |'),
  rest('rest.half', 'Half rest', 'restHalf', 'upper: r/2 C5/2 |'),
  rest('rest.quarter', 'Quarter rest', 'restQuarter', 'upper: r/4 C5/4 r/4 D5/4 |'),
  rest('rest.8th', 'Eighth rest', 'rest8th', 'upper: r/8 C5/8 D5/4 r/8 E5/8 r/4 |'),
  rest('rest.16th', '16th rest', 'rest16th', 'upper: r/16 C5/16 D5/8 C5/4 r/16 E5/16 F5/8 r/4 |'),
  rest('rest.32nd', '32nd rest', 'rest32nd', 'upper: r/32 C5/32 D5/16 E5/8 r/4 r/2 |'),
  rest('rest.64th', '64th rest', 'rest64th', 'upper: r/64 C5/64 D5/32 E5/16 F5/8 r/4 r/2 |'),
  rest('rest.128th', '128th rest', 'rest128th', 'upper: r/128 C5/128 D5/64 E5/32 F5/16 G5/8 r/4 r/2 |'),
  {
    id: 'rest.dotted', family: 'rest', name: 'Dotted rests',
    summary: 'Rests with augmentation dots, used where the meter allows (compound meters).',
    spec: '5.7', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none', inference: 'rhythm',
    examples: [{ score: `${TREBLE}time: 6/8\nupper: r/4. C5/8 D5 E5 | F5/4. r/4. |` }]
  },
  {
    id: 'rest.full-bar', family: 'rest', name: 'Full-bar rest',
    summary: 'A whole rest centred in the bar whatever the meter.',
    spec: '5.7', model: 'structure', drawing: { type: 'structure', glyphs: ['restWhole'] }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}time: 3/4\nupper: C5/4 D5 E5 | R | F5/2. |` }]
  },
  {
    id: 'rest.multi-bar', family: 'rest', name: 'Multi-bar rest',
    summary: 'Several silent bars in every staff collapsed into one H-bar with a count.',
    pending: 'Silent bars are drawn one full-bar rest each; collapsing them into one H-bar is not built yet.',
    spec: '5.7', model: 'structure', drawing: { type: 'structure', glyphs: ['restHBarLeft', 'restHBarMiddle', 'restHBarRight'] },
    layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1 | R | R | R | R | D5/1 |` }]
  },
  {
    id: 'rest.hidden', family: 'rest', name: 'Hidden rest', aliases: ['space'],
    summary: 'Time in a voice with nothing drawn, so a resting second voice leaves no stray rests.',
    spec: '5.7', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none', inference: 'voices',
    examples: [{ score: `${TREBLE}upper: E5/4 F5 G5 A5 |\nupper.2: s/2 C5/2 |` }]
  },
  accidental('acc.sharp', 'Sharp', 'accidentalSharp', 'upper: F#5/4 F5 F5 F#5 |'),
  accidental('acc.flat', 'Flat', 'accidentalFlat', 'upper: Bb4/4 B4 Eb5 E5 |'),
  accidental('acc.natural', 'Natural', 'accidentalNatural', 'key: 4\nupper: F5/4 F#5 C5 D5 |'),
  accidental('acc.double-sharp', 'Double sharp', 'accidentalDoubleSharp', 'key: 4\nupper: F##5/4 G#5 F##5 E5 |'),
  accidental('acc.double-flat', 'Double flat', 'accidentalDoubleFlat', 'key: -5\nupper: Bbb4/4 Ab4 Bbb4 Bb4 |'),
  {
    id: 'acc.courtesy', family: 'acc', name: 'Courtesy accidental', aliases: ['cautionary accidental'],
    summary: 'A reminder accidental in parentheses where none is strictly required.',
    spec: '5.8', model: 'structure', drawing: { type: 'structure', glyphs: ['accidentalParensLeft', 'accidentalParensRight'] },
    layer: 0, sizes: ['full'], playback: 'none',
    examples: [
      { score: `${TREBLE}upper: F#5/2 G5 | F5?/2 G5 |` },
      { title: 'Accidental columns in a chord', score: `${TREBLE}upper: <C#4 Eb4 G#4 Bb4 D#5>/1 |` }
    ]
  },
  {
    id: 'tuplet.number', family: 'tuplet', name: 'Tuplet number',
    summary: 'The number of a tuplet, on the beam side.',
    spec: '5.9', model: 'structure', drawing: { type: 'structure', glyphs: ['tuplet3', 'tuplet5', 'tuplet6', 'tuplet7'] },
    layer: 6, sizes: ['full'], playback: 'none', inference: 'rhythm',
    examples: [{ score: `${TREBLE}upper: 3:2{C5/8 D5 E5} 3:2{F5/8 G5 A5} 5:4{B5/16 A5 G5 F5 E5} D5/4 |` }]
  },
  {
    id: 'tuplet.bracket', family: 'tuplet', name: 'Tuplet bracket',
    summary: 'Shown when the tuplet is not one complete beam group.',
    spec: '5.9', model: 'structure', drawing: { type: 'structure' }, layer: 6, sizes: ['full'], playback: 'none', inference: 'rhythm',
    examples: [{ score: `${TREBLE}upper: 3:2{C5/4 D5 E5} 3:2{r/8 F5 G5} A5/4 |` }]
  },
  {
    id: 'tuplet.ratio', family: 'tuplet', name: 'Tuplet ratio',
    summary: 'Ratio display (7:6) when the number alone is ambiguous.',
    spec: '5.9', model: 'structure', drawing: { type: 'structure', glyphs: ['tupletColon'] }, layer: 6, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: 7:6{C5/16 D5 E5 F5 G5 A5 B5} C6/8 r/2 |` }]
  },
  {
    id: 'tuplet.nested', family: 'tuplet', name: 'Nested tuplets',
    summary: 'A tuplet inside another; brackets stack outward.',
    spec: '5.9', model: 'structure', drawing: { type: 'structure' }, layer: 6, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: 3:2{C5/4 3:2{D5/8 E5 F5} G5/4} r/2 |` }]
  }
] as const satisfies readonly CatalogueEntry[];
