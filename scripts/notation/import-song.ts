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
import type { AlignedImportSettings } from '../../src/notation/import/aligned';
import { inferOttavas } from '../../src/notation/import/ottavas';
import type { OttavaRule } from '../../src/notation/import/ottavas';
import { fromKaraokeMap } from '../../src/notation/import/sources/karaokeMap';
import { DEFAULT_TEMPO_SETTINGS, inferTempoMarks } from '../../src/notation/import/tempo';
import type { PerformedNote, TempoSettings } from '../../src/notation/import/tempo';
import { encodeScore } from '../../src/notation/model/codec';
import { applyEdits } from '../../src/notation/model/edits';
import type { Edit } from '../../src/notation/model/edits';
import { ScoreIndex } from '../../src/notation/model/query';
import type { ClefKind, Score } from '../../src/notation/model/types';
import { validateScore } from '../../src/notation/model/validate';

interface SongFile {
  readonly id: string;
  readonly source: { readonly format: 'karaoke-map'; readonly file: string };
  readonly import: AlignedImportSettings;
  readonly ottavas?: Partial<Record<ClefKind, OttavaRule>>;
  readonly tempo?: TempoSettings | false;
}

const id = process.argv[2];
if (!id) throw new Error('Usage: import-song.ts <song-id>');
const folder = join(process.cwd(), 'src/data/score', id);
const read = (file: string) => JSON.parse(readFileSync(join(folder, file), 'utf8'));
const write = (file: string, value: unknown) => writeFileSync(join(folder, file), `${JSON.stringify(value, null, 1)}\n`);
const song = read('song.json') as SongFile;

const source = fromKaraokeMap(read(song.source.file), song.import.staves.map(staff => staff.id));
const imported = importAligned(source, song.import);
let score: Score = imported.score;

if (song.ottavas) score = { ...score, spanners: [...score.spanners, ...inferOttavas(score, song.ottavas)] };

if (song.tempo !== false) {
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
write('score.generated.json', encodeScore(score));
write('timing.json', imported.timing);

const edits: Edit[] = existsSync(join(folder, 'edits.json')) ? read('edits.json') : [];
const edited = applyEdits(score, edits);
check('score.json', edited);
write('score.json', encodeScore(edited));

const count = (kind: string) => edited.attachments.filter(item => item.kind === kind).length + edited.spanners.filter(item => item.kind === kind).length;
console.log(`${id}: ${edited.measures.length} measures, ${edited.events.length} events, ${warnings} warnings`);
console.log(`  rolled chords ${imported.report.rolledChords}, triplet beats ${imported.report.tripletBeats}, ties ${imported.report.ties}, corrections ${imported.report.corrections}`);
console.log(`  ottavas ${count('ottava.8va')}, fermatas ${count('artic.fermata')}, tempo changes ${count('tempo.change')}, a tempo ${count('tempo.return')}, edits ${edits.length}`);
