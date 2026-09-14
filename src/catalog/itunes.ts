export interface FetchAlbumArtOptions {
  country?: string;
  coverUrl?: string;
  badgeEl?: HTMLElement;
}

// In-memory cache for resolved artwork URLs
const artCache = new Map<string, string>();

/**
 * Normalizes string for fuzzy track/artist matching.
 */
function normalize(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Strips punctuation that often disrupts the iTunes search tokenizer (e.g. trailing ! in "Chop Suey!").
 */
function cleanQueryTerm(term: string): string {
  return (term || '')
    .replace(/[!?,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores an iTunes search result against target artist and track.
 * Higher score is better. Penalizes unintended remixes, karaokes, and covers.
 */
function scoreResult(targetArtist: string, targetTrack: string, r: any): number {
  if (!r || !r.artworkUrl100) return -1;

  const targetA = normalize(targetArtist);
  const targetT = normalize(targetTrack);
  const resultA = normalize(r.artistName || '');
  const resultT = normalize(r.trackName || '');

  let score = 0;

  // Track name exact match
  if (resultT === targetT) {
    score += 100;
  } else if (resultT.includes(targetT) || targetT.includes(resultT)) {
    score += 60;
  }

  // Artist match
  if (resultA === targetA) {
    score += 50;
  } else if (resultA.includes(targetA) || targetA.includes(resultA)) {
    score += 30;
  }

  // Check if original query asks for remix
  const queryIsRemix = targetT.includes('remix') || targetA.includes('remix');
  const resultIsRemix = resultT.includes('remix');

  if (resultIsRemix && !queryIsRemix) {
    score -= 40; // Penalize unwanted remixes
  }

  // Penalize karaoke, lullabies, tributes, acoustic covers
  if (/karaoke|lullaby|tribute|cover|instrumental/i.test(resultT + ' ' + (r.collectionName || ''))) {
    score -= 80;
  }

  return score;
}

/**
 * Searches iTunes API for a specific country storefront.
 */
async function searchStorefront(artist: string, track: string, country?: string): Promise<string | null> {
  const cleanTrack = cleanQueryTerm(track);
  const cleanArtist = cleanQueryTerm(artist);
  const term = encodeURIComponent(`${cleanArtist} ${cleanTrack}`);
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : '';
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=10${countryParam}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const results = data.results || [];
    if (results.length === 0) return null;

    let bestResult: any = null;
    let bestScore = -100;

    for (const r of results) {
      const s = scoreResult(artist, track, r);
      if (s > bestScore) {
        bestScore = s;
        bestResult = r;
      }
    }

    if (bestResult && bestScore > 0 && bestResult.artworkUrl100) {
      return bestResult.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
    }

    // Fallback: if highest score result has art
    if (results[0]?.artworkUrl100) {
      return results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches high-resolution album artwork from the iTunes Search API.
 * Supports smart candidate scoring, regional storefront fallbacks, and caching.
 */
export function fetchAlbumArt(
  artist: string,
  track: string,
  imgEl: HTMLImageElement,
  options?: FetchAlbumArtOptions | HTMLElement
): void {
  const opts: FetchAlbumArtOptions = (options && 'country' in options) || (options && 'coverUrl' in options)
    ? (options as FetchAlbumArtOptions)
    : { badgeEl: options as HTMLElement | undefined };

  const { country, coverUrl, badgeEl } = opts;

  // Direct explicit cover URL override
  if (coverUrl) {
    imgEl.src = coverUrl;
    if (badgeEl) badgeEl.textContent = 'Custom Art';
    return;
  }

  // Normalizations & known track aliases
  let queryArtist = artist;
  let queryTrack = track;

  if (artist.toLowerCase() === 'ic3peak' && track.toLowerCase() === 'boo-hoo') {
    queryTrack = 'Плак-плак';
  } else if (artist.toLowerCase() === 'unknown' && track.toLowerCase() === 'inori') {
    queryArtist = 'Creepy Corpse Corp';
  }

  const cacheKey = `${queryArtist}::${queryTrack}::${country || 'default'}`;

  // Check in-memory cache
  if (artCache.has(cacheKey)) {
    const cached = artCache.get(cacheKey)!;
    imgEl.src = cached;
    if (badgeEl) badgeEl.textContent = 'iTunes Match';
    return;
  }

  // Check sessionStorage
  try {
    const stored = sessionStorage.getItem(`_art_${cacheKey}`);
    if (stored) {
      artCache.set(cacheKey, stored);
      imgEl.src = stored;
      if (badgeEl) badgeEl.textContent = 'iTunes Match';
      return;
    }
  } catch {}

  if (badgeEl) badgeEl.textContent = 'Searching iTunes...';

  // Perform search with potential regional fallbacks
  (async () => {
    // 1. Primary search (with specified country or default)
    let artUrl = await searchStorefront(queryArtist, queryTrack, country);

    // 2. If no result and country wasn't explicitly given, try common storefronts
    if (!artUrl && !country) {
      const fallbacks = ['gb', 'no', 'be', 'fr', 'jp', 'us'];
      for (const fb of fallbacks) {
        artUrl = await searchStorefront(queryArtist, queryTrack, fb);
        if (artUrl) break;
      }
    }

    if (artUrl) {
      artCache.set(cacheKey, artUrl);
      try {
        sessionStorage.setItem(`_art_${cacheKey}`, artUrl);
      } catch {}

      imgEl.src = artUrl;
      if (badgeEl) badgeEl.textContent = 'iTunes Match';
    } else {
      if (badgeEl) badgeEl.textContent = 'No Art Found';
    }
  })().catch(() => {
    if (badgeEl) badgeEl.textContent = 'Art Offline';
  });
}
