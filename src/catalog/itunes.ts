import type { SongMetadata } from '../types/karaoke';

/** What to look a song's cover up by. `coverUrl` skips the lookup. */
export interface AlbumArtQuery {
  artist: string;
  track: string;
  country?: string;
  coverUrl?: string;
}

export interface AlbumArtOptions {
  /** Edge length in pixels to request; iTunes serves any square size. */
  size?: number;
  /** Shows the lookup's progress, for the studio. */
  badgeEl?: HTMLElement;
}

interface ItunesResult {
  artworkUrl100?: string;
  artistName?: string;
  trackName?: string;
  collectionName?: string;
}

const DEFAULT_SIZE = 600;
/** Storefronts tried in turn when a song names no country and the default one has no match. */
const FALLBACK_STOREFRONTS = ['gb', 'no', 'be', 'fr', 'jp', 'us'];
const STORE_PREFIX = 'karaoke.art.';
const NOT_FOUND = 'none';

/** Lookups by query, shared so the same cover is never requested twice at once. */
const lookups = new Map<string, Promise<string | null>>();

export function albumArtQuery(song: SongMetadata): AlbumArtQuery {
  return {
    artist: song.itunesArtist || song.artist,
    track: song.itunesTrack || song.title,
    country: song.itunesCountry,
    coverUrl: song.coverUrl
  };
}

function normalize(text: string): string {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Punctuation such as the `!` in "Chop Suey!" derails the iTunes search tokenizer. */
function cleanQueryTerm(term: string): string {
  return (term || '').replace(/[!?,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** How well a search result matches the song; higher is better, and remixes, covers and karaoke versions lose. */
function scoreResult(artist: string, track: string, result: ItunesResult): number {
  if (!result.artworkUrl100) return -1;

  const wantedArtist = normalize(artist);
  const wantedTrack = normalize(track);
  const foundArtist = normalize(result.artistName || '');
  const foundTrack = normalize(result.trackName || '');

  let score = 0;
  if (foundTrack === wantedTrack) score += 100;
  else if (foundTrack.includes(wantedTrack) || wantedTrack.includes(foundTrack)) score += 60;

  if (foundArtist === wantedArtist) score += 50;
  else if (foundArtist.includes(wantedArtist) || wantedArtist.includes(foundArtist)) score += 30;

  const wantsRemix = wantedTrack.includes('remix') || wantedArtist.includes('remix');
  if (foundTrack.includes('remix') && !wantsRemix) score -= 40;
  if (/karaoke|lullaby|tribute|cover|instrumental/i.test(`${foundTrack} ${result.collectionName || ''}`)) score -= 80;

  return score;
}

/** The 100px artwork URL of the best match in one storefront. */
async function searchStorefront(artist: string, track: string, country?: string): Promise<string | null> {
  const term = encodeURIComponent(`${cleanQueryTerm(artist)} ${cleanQueryTerm(track)}`);
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : '';
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10${countryParam}`);
    if (!res.ok) return null;
    const results = (await res.json() as { results?: ItunesResult[] }).results ?? [];

    let best: ItunesResult | undefined;
    let bestScore = 0;
    for (const result of results) {
      const score = scoreResult(artist, track, result);
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
    }
    // Nothing scored as a match: the first result's cover is still better than none.
    return (best ?? results[0])?.artworkUrl100 ?? null;
  } catch {
    return null;
  }
}

async function searchItunes({ artist, track, country }: AlbumArtQuery): Promise<string | null> {
  const found = await searchStorefront(artist, track, country);
  if (found || country) return found;
  for (const storefront of FALLBACK_STOREFRONTS) {
    const fallback = await searchStorefront(artist, track, storefront);
    if (fallback) return fallback;
  }
  return null;
}

// Covers are remembered across visits; a miss only for this session, so it is retried later.
// Storage throws in private windows and when site data is blocked, where every visit looks covers up again.
function readStored(key: string): string | null | undefined {
  try {
    const found = localStorage.getItem(STORE_PREFIX + key);
    if (found) return found;
    return sessionStorage.getItem(STORE_PREFIX + key) === NOT_FOUND ? null : undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, url: string | null): void {
  try {
    if (url) localStorage.setItem(STORE_PREFIX + key, url);
    else sessionStorage.setItem(STORE_PREFIX + key, NOT_FOUND);
  } catch {
    // The lookup still succeeded; it just will not be remembered.
  }
}

/** The song's 100px iTunes artwork URL, or null when iTunes has no match. */
function lookUp(query: AlbumArtQuery): Promise<string | null> {
  const key = `${query.artist}::${query.track}::${query.country || 'default'}`;
  let lookup = lookups.get(key);
  if (!lookup) {
    const stored = readStored(key);
    lookup = stored !== undefined
      ? Promise.resolve(stored)
      : searchItunes(query).then(url => {
        store(key, url);
        return url;
      });
    lookups.set(key, lookup);
  }
  return lookup;
}

/** Puts the song's cover on `imgEl`: its own `coverUrl` if it has one, else the best iTunes match. */
export function fetchAlbumArt(query: AlbumArtQuery, imgEl: HTMLImageElement, { size = DEFAULT_SIZE, badgeEl }: AlbumArtOptions = {}): void {
  const setBadge = (text: string) => {
    if (badgeEl) badgeEl.textContent = text;
  };
  // The image element is reused between songs; a slower, older lookup must not overwrite a newer one.
  const request = `${query.artist}::${query.track}::${query.coverUrl ?? ''}`;
  imgEl.dataset.artRequest = request;

  if (query.coverUrl) {
    imgEl.src = query.coverUrl;
    setBadge('Custom Art');
    return;
  }

  setBadge('Searching iTunes...');
  lookUp(query).then(url => {
    if (imgEl.dataset.artRequest !== request) return;
    if (url) imgEl.src = url.replace('100x100bb', `${size}x${size}bb`);
    setBadge(url ? 'iTunes Match' : 'No Art Found');
  });
}
