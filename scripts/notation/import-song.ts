/**
 * Imports a song's score: `npx tsx scripts/notation/import-song.ts <song-id>`.
 *
 * Reads src/data/score/<song-id>/song.json, runs the source through the
 * import passes, and writes
 *   score.generated.json  the import, never edited by hand
 *   timing.json           when every note sounds (from the recording)
 *   score.json            the import with edits.json applied, validated
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as F from '../../src/notation/core/fraction';
import { importAligned } from '../../src/notation/import/aligned';
import { appendClosingPassage } from '../../src/notation/import/closingPassage';
import type { AlignedImportSettings } from '../../src/notation/import/aligned';
import { inferClefChanges } from '../../src/notation/import/clefs';
import type { ClefRule } from '../../src/notation/import/clefs';
import { inferOttavas } from '../../src/notation/import/ottavas';
import type { OttavaRule } from '../../src/notation/import/ottavas';
import { fromKaraokeMap } from '../../src/notation/import/sources/karaokeMap';
import { DEFAULT_TEMPO_SETTINGS, inferTempoMarks } from '../../src/notation/import/tempo';
import type { PerformedNote, TempoSettings } from '../../src/notation/import/tempo';
import { decodeScore, encodeScore } from '../../src/notation/model/codec';
import { applyEdits } from '../../src/notation/model/edits';
import type { Edit } from '../../src/notation/model/edits';
import { ScoreIndex } from '../../src/notation/model/query';
import type { ClefKind, Score } from '../../src/notation/model/types';
import { validateScore } from '../../src/notation/model/validate';

interface SongFile {
  readonly id: string;
  readonly source: { readonly format: 'karaoke-map' | 'score-json'; readonly file: string; readonly timing?: string; readonly closingPassage?: string };
  readonly import?: AlignedImportSettings;
  readonly clefs?: Record<string, ClefRule>;
  readonly ottavas?: Partial<Record<ClefKind, OttavaRule>>;
  readonly tempo?: TempoSettings | false;
}

const id = process.argv[2];
if (!id) throw new Error('Usage: import-song.ts <song-id>');
const folder = join(process.cwd(), 'src/data/score', id);
const read = (file: string) => JSON.parse(readFileSync(join(folder, file), 'utf8'));
const write = (file: string, value: unknown) => writeFileSync(join(folder, file), `${JSON.stringify(value, null, 1)}\n`);
const song = read('song.json') as SongFile;

let source: ReturnType<typeof fromKaraokeMap> | undefined;
let imported: ReturnType<typeof importAligned> | undefined;
if (song.source.format === 'karaoke-map') {
  if (!song.import) throw new Error('A karaoke-map source needs import settings');
  source = fromKaraokeMap(read(song.source.file), song.import.staves.map(staff => staff.id));
  imported = importAligned(source, song.import);
} else if (song.source.format !== 'score-json') throw new Error(`Unknown source format ${song.source.format}`);
let score: Score = imported ? imported.score : decodeScore(read(song.source.file));
if (!imported && !song.source.timing) throw new Error('A score-json source needs a timing file');
let timing = imported?.timing ?? read(song.source.timing!);
if (song.source.closingPassage) {
  const extended = appendClosingPassage(score, timing, read(song.source.closingPassage));
  score = extended.score;
  timing = extended.timing;
}

// Clefs first: an octave line is judged in the clef its notes are read in.
if (song.clefs) score = inferClefChanges(score, song.clefs);
if (song.ottavas) score = { ...score, spanners: [...score.spanners, ...inferOttavas(score, song.ottavas)] };

if (song.tempo !== false && imported && source) {
  const index = new ScoreIndex(score);
  const performed = new Map<string, PerformedNote>();
  const attacked = new Set<number>();
  const beats = new Set(imported.timing.beats.map(beat => Number(beat.position.toFixed(9))));
  for (const event of score.events) {
    if (event.kind !== 'chord') continue;
    const position = Number(F.toNumber(index.absolute(event.measure, event.offset)).toFixed(9));
    for (const note of event.notes) {
      if (note.id.includes('~')) continue;
      const timing = imported.timing.notes[note.id];
      performed.set(note.id, { start: timing.start, end: source.notes.find(item => item.id === note.id)!.audioEnd });
      if (beats.has(position)) attacked.add(position);
    }
  }
  const marks = inferTempoMarks(score, imported.clock, performed, attacked, { ...DEFAULT_TEMPO_SETTINGS, ...song.tempo });
  score = { ...score, attachments: [...score.attachments, ...marks.attachments], spanners: [...score.spanners, ...marks.spanners] };
}

const check = (label: string, value: Score) => {
  const issues = validateScore(value);
  const errors = issues.filter(issue => issue.level === 'error');
  if (errors.length) {
    for (const error of errors.slice(0, 20)) console.error(`${label}: ${error.message}${error.ref ? ` (${error.ref})` : ''}`);
    throw new Error(`${label} has ${errors.length} errors`);
  }
  return issues.length;
};
const warnings = check('score.generated.json', score);
const edits: Edit[] = existsSync(join(folder, 'edits.json')) ? read('edits.json') : [];
const edited = applyEdits(score, edits);
check('score.json', edited);
// Fail before writing the runtime bundle if any note is untimed or the beat
// clock is invalid. Playback binary-searches these beats in both directions.
for (const event of edited.events) if (event.kind === 'chord') for (const note of event.notes) {
  const value = timing.notes?.[note.id];
  if (!value || ![value.start, value.glideEnd, value.soundingEnd].every(Number.isFinite) ||
      value.start < 0 || value.glideEnd <= value.start || value.soundingEnd < value.glideEnd)
    throw new Error(`Invalid or missing timing for ${note.id}`);
}
if (!Array.isArray(timing.beats) || timing.beats.length < 2) throw new Error('Timing needs at least two beats');
for (let index = 0; index < timing.beats.length; index++) {
  const beat = timing.beats[index], previous = timing.beats[index - 1];
  if (![beat.position, beat.time].every(Number.isFinite) ||
      (previous && (beat.position <= previous.position || beat.time <= previous.time)))
    throw new Error(`Invalid beat clock at beat ${index}`);
}
write('score.generated.json', encodeScore(score));
write('timing.json', timing);
write('score.json', encodeScore(edited));

const count = (kind: string) => edited.attachments.filter(item => item.kind === kind).length + edited.spanners.filter(item => item.kind === kind).length;
console.log(`${id}: ${edited.measures.length} measures, ${edited.events.length} events, ${warnings} warnings`);
if (imported) console.log(`  rolled chords ${imported.report.rolledChords}, triplet beats ${imported.report.tripletBeats}, ties ${imported.report.ties}, corrections ${imported.report.corrections}, notes moved to the other hand ${imported.report.handMoves}`);
console.log(`  ottavas ${count('ottava.8va')}, fermatas ${count('artic.fermata')}, tempo changes ${count('tempo.change')}, a tempo ${count('tempo.return')}, edits ${edits.length}`);
