/**
 * The score's JSON form, docs §11. Fractions are written "3/8" and pitches
 * "F#4", so files stay readable and diff well; everything else is the model
 * as it is. Decoding validates the shape; `validateScore` checks the music.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { formatPitch, parsePitch } from '../core/pitch';
import type { Score } from './types';

/** Walks a value and converts every field the codec knows by name. */
type Converter = { fraction: (value: unknown) => unknown; pitch: (value: unknown) => unknown };

const FRACTION_FIELDS = new Set(['offset', 'length']);

function convert(value: unknown, converter: Converter, key?: string): unknown {
  if (Array.isArray(value)) return value.map(item => convert(item, converter));
  if (value && typeof value === 'object') {
    if (key && FRACTION_FIELDS.has(key)) return converter.fraction(value);
    if (key === 'pitch') return converter.pitch(value);
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      if (item === undefined) continue;
      result[name] = convert(item, converter, name);
    }
    return result;
  }
  if (typeof value === 'string' && key && FRACTION_FIELDS.has(key)) return converter.fraction(value);
  if (typeof value === 'string' && key === 'pitch') return converter.pitch(value);
  return value;
}

export function encodeScore(score: Score): unknown {
  return convert(score, {
    fraction: value => F.format(value as Fraction),
    pitch: value => formatPitch(value as Parameters<typeof formatPitch>[0])
  });
}

export function decodeScore(json: unknown): Score {
  const score = convert(json, {
    fraction: value => (typeof value === 'string' ? F.parse(value) : value),
    pitch: value => (typeof value === 'string' ? parsePitch(value) : value)
  }) as Score;
  if (score?.schema !== 1) throw new Error('Not a schema-1 score');
  for (const field of ['staves', 'groups', 'measures', 'events', 'tuplets', 'clefs', 'attachments', 'spanners'] as const)
    if (!Array.isArray(score[field])) throw new Error(`Score is missing ${field}`);
  return score;
}

export function scoreToJson(score: Score): string {
  return JSON.stringify(encodeScore(score));
}
