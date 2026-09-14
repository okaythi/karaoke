import type { SongCatalogItem } from '../types/karaoke';

export interface FuzzySearchResult {
  item: SongCatalogItem;
  score: number;
}

/**
 * Normalizes string by stripping diacritics and lowercasing.
 */
function normalizeForSearch(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Computes a fuzzy match score between target string and search query.
 * Lower score is better (0 = exact match). Returns -1 if no match.
 */
function fuzzyScore(target: string, query: string): number {
  const normTarget = normalizeForSearch(target);
  const normQuery = normalizeForSearch(query);

  if (!normQuery) return 0;
  if (!normTarget) return -1;

  // Exact match
  if (normTarget === normQuery) return 0;

  // Prefix match
  if (normTarget.startsWith(normQuery)) return 10;

  // Word boundary match (e.g. "go" matches "Go To Hell")
  const words = normTarget.split(/[\s-_]+/);
  if (words.some(w => w.startsWith(normQuery))) return 20;

  // Substring match
  const substrIdx = normTarget.indexOf(normQuery);
  if (substrIdx !== -1) {
    return 30 + substrIdx;
  }

  // Sequential character match (fuzzy subsequence)
  let tIdx = 0;
  let qIdx = 0;
  let distance = 0;

  while (tIdx < normTarget.length && qIdx < normQuery.length) {
    if (normTarget[tIdx] === normQuery[qIdx]) {
      qIdx++;
    } else {
      distance++;
    }
    tIdx++;
  }

  if (qIdx === normQuery.length) {
    return 100 + distance;
  }

  return -1;
}

/**
 * Filters and ranks a list of songs based on a fuzzy search query.
 */
export function fuzzyFilterSongs(
  songs: SongCatalogItem[],
  query: string
): SongCatalogItem[] {
  const cleanQuery = query.trim();
  if (!cleanQuery) return songs;

  const results: FuzzySearchResult[] = [];

  for (const song of songs) {
    const scores = [
      fuzzyScore(song.title, cleanQuery),
      fuzzyScore(song.artist, cleanQuery),
      song.itunesTrack ? fuzzyScore(song.itunesTrack, cleanQuery) : -1,
      song.itunesArtist ? fuzzyScore(song.itunesArtist, cleanQuery) : -1,
      fuzzyScore(song.id, cleanQuery)
    ].filter(s => s !== -1);

    if (scores.length > 0) {
      const bestScore = Math.min(...scores);
      results.push({ item: song, score: bestScore });
    }
  }

  // Sort by best score first, then alphabetically by title
  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.item.title.localeCompare(b.item.title);
  });

  return results.map(r => r.item);
}
