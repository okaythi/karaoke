import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

const clef = <const Id extends string>(id: Id, name: string, glyph: string, summary: string, example: string) => ({
  id, family: 'clef', name, summary, spec: '5.2', model: 'structure',
  drawing: { type: 'structure', glyphs: [glyph] }, layer: 0, sizes: ['full', 'change'], playback: 'none',
  inference: 'clefs', examples: [{ score: example }]
}) as const;

export const SIGNATURES = [
  {
    ...clef('clef.treble', 'Treble clef', 'gClef', 'G clef on the second line.', `${TREBLE}upper: G4/4 B4 D5 G5 |`),
    examples: [
      { score: `${TREBLE}upper: G4/4 B4 D5 G5 |` },
      { title: 'Changes within a line, at reduced size', score: `${TREBLE}upper: C5/4 A4 clef=bass E3 C3 | G2/2 clef=treble G4/2 |` },
      { title: 'Courtesy clef before a line break', score: `${TREBLE}upper: C5/1 | D5/1 | E5/1 | clef=bass C3/1 | E3/1 |`, width: 35 }
    ]
  },
  clef('clef.bass', 'Bass clef', 'fClef', 'F clef on the fourth line.', 'staves: lower bass\nlower: F2/4 A2 C3 F3 |'),
  clef('clef.alto', 'Alto clef', 'cClef', 'C clef on the middle line.', 'staves: viola alto\nviola: C4/4 E4 G4 C5 |'),
  clef('clef.tenor', 'Tenor clef', 'cClef', 'C clef on the fourth line.', 'staves: cello tenor\ncello: C4/4 E4 G4 C5 |'),
  clef('clef.treble-8vb', 'Treble clef 8vb', 'gClef8vb', 'Treble clef sounding an octave lower.', 'staves: tenor treble-8vb\ntenor: C4/4 E4 G4 C5 |'),
  clef('clef.treble-8va', 'Treble clef 8va', 'gClef8va', 'Treble clef sounding an octave higher.', 'staves: piccolo treble-8va\npiccolo: C6/4 E6 G6 C7 |'),
  clef('clef.bass-8vb', 'Bass clef 8vb', 'fClef8vb', 'Bass clef sounding an octave lower.', 'staves: contra bass-8vb\ncontra: C2/4 E2 G2 C3 |'),
  clef('clef.baritone-f', 'Baritone F clef', 'fClef', 'F clef on the third line.', 'staves: lower baritone-f\nlower: B2/4 D3 F3 A3 |'),
  {
    id: 'key.signature', family: 'key', name: 'Key signature',
    summary: 'Sharps or flats at the start of every line, in their fixed order and positions per clef.',
    spec: '5.3', model: 'structure', drawing: { type: 'structure', glyphs: ['accidentalSharp', 'accidentalFlat'] },
    layer: 0, sizes: ['full'], playback: 'none', inference: 'key',
    examples: [
      { title: 'Four sharps (E major / C♯ minor)', score: 'key: 4\nupper: E5/1 |\nlower: E3/1 |' },
      { title: 'Five flats (D♭ major)', score: 'key: -5\nupper: Db5/1 |\nlower: Db3/1 |' },
      { title: 'Seven sharps, alto clef', score: 'staves: viola alto\nkey: 7\nviola: C#4/1 |' }
    ]
  },
  {
    id: 'key.change', family: 'key', name: 'Key change',
    summary: 'A new key signature after a double barline, cancelling the old one with naturals where needed.',
    spec: '5.3', model: 'structure', drawing: { type: 'structure', glyphs: ['accidentalNatural'] },
    layer: 0, sizes: ['full'], playback: 'none', inference: 'key',
    examples: [
      { title: 'C♯ minor to D♭ major', score: 'key: 4\nupper: C#5/1 | key=-5 Db5/1 |\nlower: C#3/1 | Db3/1 |' },
      { title: 'Two sharps to one', score: `${TREBLE}key: 2\nupper: D5/1 | key=1 G4/1 |` }
    ]
  },
  {
    id: 'key.courtesy', family: 'key', name: 'Courtesy key signature',
    summary: 'The new key repeated at the end of a line when the change falls at the start of the next.',
    spec: '5.3', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}key: 4\nupper: E5/1 | E5/1 | E5/1 | key=-5 Db5/1 | Db5/1 |`, width: 44 }]
  },
  {
    id: 'time.numeric', family: 'time', name: 'Time signature',
    summary: 'Beats per bar over the beat unit, drawn on the first line and at changes.',
    spec: '5.4', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [
      { title: '3/4', score: `${TREBLE}time: 3/4\nupper: C5/4 D5 E5 |` },
      { title: '6/8', score: `${TREBLE}time: 6/8\nupper: C5/8 D5 E5 F5 G5 A5 |` },
      { title: '12/8', score: `${TREBLE}time: 12/8\nupper: C5/4. D5 E5 F5 |` },
      { title: '5/4', score: `${TREBLE}time: 5/4\nupper: C5/4 D5 E5 F5 G5 |` }
    ]
  },
  {
    id: 'time.common', family: 'time', name: 'Common time', aliases: ['C'],
    summary: '4/4 drawn as C.',
    spec: '5.4', model: 'structure', drawing: { type: 'structure', glyphs: ['timeSigCommon'] }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}time: 4/4 common\nupper: C5/4 D5 E5 F5 |` }]
  },
  {
    id: 'time.cut', family: 'time', name: 'Cut time', aliases: ['alla breve', '₵'],
    summary: '2/2 drawn as ₵; beams and beats follow the half note.',
    spec: '5.4', model: 'structure', drawing: { type: 'structure', glyphs: ['timeSigCutCommon'] }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}time: 2/2 cut\nupper: C5/8 D5 E5 F5 G5 A5 B5 C6 |` }]
  },
  {
    id: 'time.courtesy', family: 'time', name: 'Courtesy time signature',
    summary: 'The new time signature at the end of a line when the change falls at the start of the next.',
    spec: '5.4', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1 | C5/1 | C5/1 | time=3/4 C5/2. | C5/2. |`, width: 32 }]
  }
] as const satisfies readonly CatalogueEntry[];
