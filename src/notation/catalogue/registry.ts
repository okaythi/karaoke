import { CONNECTIONS } from './families/connections';
import { DYNAMICS } from './families/dynamics';
import { LINES } from './families/lines';
import { MARKS } from './families/marks';
import { NAVIGATION } from './families/navigation';
import { NOTES } from './families/notes';
import { SIGNATURES } from './families/signatures';
import { STAFF } from './families/staff';
import type { CatalogueEntry, Family } from './types';

/** Every notation the engine knows, in reading order. */
export const CATALOGUE = [
  ...STAFF, ...SIGNATURES, ...NOTES, ...CONNECTIONS, ...MARKS, ...DYNAMICS, ...LINES, ...NAVIGATION
] as const;

/** The same entries typed as plain catalogue entries, for code that reads optional fields. */
export const ENTRIES: readonly CatalogueEntry[] = CATALOGUE;

const byId = new Map<string, CatalogueEntry>(CATALOGUE.map(entry => [entry.id, entry]));
if (byId.size !== CATALOGUE.length) {
  const seen = new Set<string>();
  const duplicates = CATALOGUE.filter(entry => seen.size === seen.add(entry.id).size).map(entry => entry.id);
  throw new Error(`Duplicate catalogue IDs: ${duplicates.join(', ')}`);
}

export function entry(id: string): CatalogueEntry {
  const found = byId.get(id);
  if (!found) throw new Error(`Unknown notation "${id}"`);
  return found;
}

export function isNotation(id: string): boolean {
  return byId.has(id);
}

export function entriesOf(family: Family): CatalogueEntry[] {
  return CATALOGUE.filter(item => item.family === family);
}
