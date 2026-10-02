import type { CatalogueEntry } from '../types';

const TREBLE = 'staves: upper treble\n';

export const STAFF = [
  {
    id: 'staff.lines', family: 'staff', name: 'Staff', aliases: ['stave', 'five lines'],
    summary: 'Five lines that every note, rest and mark is positioned against.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/4 D5 E5 F5 |` }]
  },
  {
    id: 'staff.ledger', family: 'staff', name: 'Ledger lines',
    summary: 'Short lines extending the staff for notes above or below it.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full', 'grace', 'cue'], playback: 'none',
    examples: [
      { title: 'Above and below', score: `${TREBLE}upper: A5/4 C6 E6 A6 | A3/4 F3 <C4 E4>/2 |` },
      { title: 'Seconds on ledger lines', score: `${TREBLE}upper: <B5 C6>/2 <C4 D4>/2 |` }
    ]
  },
  {
    id: 'staff.brace', family: 'staff', name: 'Brace', aliases: ['grand staff brace'],
    summary: 'Curly brace joining the staves of one instrument (the piano grand staff).',
    spec: '5.1', model: 'structure', drawing: { type: 'structure', glyphs: ['brace'] }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: E5/2 G5 |\nlower: C3/1 |' }]
  },
  {
    id: 'staff.bracket', family: 'staff', name: 'Bracket',
    summary: 'Square bracket joining the staves of different instruments. Reserved for multi-part scores.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure', glyphs: ['bracket'] }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: 'group: bracket\nupper: E5/2 G5 |\nlower: C3/1 |' }]
  },
  {
    id: 'staff.system-line', family: 'staff', name: 'System line',
    summary: 'The vertical line joining all staves at the start of each line of music.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: E5/2 G5 |\nlower: C3/1 |' }]
  },
  {
    id: 'staff.bar-number', family: 'staff', name: 'Bar number', aliases: ['measure number'],
    summary: 'The number of the first bar of each line, except the first line.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 8, sizes: ['small-text'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1 | D5/1 | E5/1 | F5/1 | G5/1 | A5/1 | B5/1 | C6/1 |`, width: 40 }]
  },
  {
    id: 'barline.single', family: 'barline', name: 'Barline',
    summary: 'Separates measures; runs through every staff of a brace group.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: 'upper: C5/2 D5 | E5/1 |\nlower: C3/1 | G2/1 |' }]
  },
  {
    id: 'barline.double', family: 'barline', name: 'Double barline',
    summary: 'Two thin lines: the end of a section, and always before a key change.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/1 |double E5/1 | key=-3 Eb5/1 |` }]
  },
  {
    id: 'barline.final', family: 'barline', name: 'Final barline',
    summary: 'Thin and thick line closing the piece.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: G4/2 B4 | C5/1 |final` }]
  },
  {
    id: 'barline.dashed', family: 'barline', name: 'Dashed barline',
    summary: 'A subdivision of a long measure that is not a real barline.',
    spec: '5.1', model: 'structure', drawing: { type: 'structure' }, layer: 0, sizes: ['full'], playback: 'none',
    examples: [{ score: `${TREBLE}upper: C5/2 D5 |dashed E5/2 F5 |` }]
  }
] as const satisfies readonly CatalogueEntry[];
