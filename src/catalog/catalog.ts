import { mediaUrl } from '../core/media';
import { parseSongInfoFromFilename, canonicalSongId } from '../core/tokenizer';
import manifestData from '../data/songs-manifest.json';
import { isProtectedSong, PROTECTED_MEDIA_PATH, PROTECTED_SONG_ID } from '../security/protectedSong.js';
import type { SongMetadata, SongCatalogItem, SongLyricFile, R2VideoItem } from '../types/karaoke';
import { sortSongs } from './sorter';

const manifest = manifestData as SongMetadata[];

// One lazily loaded chunk per lyric file committed to git.
const lyricModules = import.meta.glob<SongLyricFile>('../data/lyrics/*.json', { import: 'default' });

/** What R2 holds: the video files, and the songs with a live lyric overlay. */
interface MediaListing {
  videoKeys: string[];
  liveLyrics: Set<string>;
}

async function fetchMediaListing(): Promise<MediaListing | null> {
  try {
    const res = await fetch('/api/karaoke/videos');
    if (!res.ok) return null;
    const data = await res.json() as { videos?: (R2VideoItem | string)[]; liveLyrics?: string[] };
    return {
      videoKeys: (data.videos ?? []).map(video => typeof video === 'string' ? video : video.key),
      liveLyrics: new Set(data.liveLyrics ?? [])
    };
  } catch (error) {
    console.warn('[catalog] media listing unavailable, using the bundled manifest:', error);
    return null;
  }
}

/** The stem that replaces a video's audio when the vocals are removed, if R2 holds one. */
function instrumentalKey(song: SongMetadata, videoKeys: Set<string> | null): string | null {
  if (song.instrumentalFile) return song.instrumentalFile;
  const conventional = `${song.videoFile.replace(/\.[^/.]+$/, '')} (Instrumental).m4a`;
  return videoKeys?.has(conventional) ? conventional : null;
}

/** Without a listing, every manifest song is assumed to be in R2. */
function buildCatalog(listing: MediaListing | null): SongCatalogItem[] {
  const videoKeys = listing ? new Set(listing.videoKeys) : null;

  const catalog: SongCatalogItem[] = manifest.map(song => {
    const isProtected = isProtectedSong(song.id);
    const stem = isProtected ? null : instrumentalKey(song, videoKeys);
    return {
      ...song,
      isOnR2: videoKeys ? videoKeys.has(song.videoFile) : true,
      hasLyrics: !song.scoreOnly,
      hasLiveLyrics: listing?.liveLyrics.has(song.id),
      videoUrl: isProtected ? PROTECTED_MEDIA_PATH : mediaUrl(song.videoFile),
      instrumentalUrl: stem ? mediaUrl(stem) : null
    };
  });

  // Videos in R2 that the manifest does not know yet: uploaded, perhaps synced live, not yet committed.
  const known = new Set(manifest.map(song => song.videoFile));
  for (const videoKey of listing?.videoKeys ?? []) {
    if (known.has(videoKey)) continue;
    const { artist, title } = parseSongInfoFromFilename(videoKey);
    const id = canonicalSongId(artist, title);
    const hasLyrics = listing!.liveLyrics.has(id);
    catalog.push({
      id,
      videoFile: videoKey,
      title,
      artist,
      globalOffset: 0,
      hasTranslation: false,
      isDialect: false,
      isOnR2: true,
      hasLyrics,
      hasLiveLyrics: hasLyrics,
      videoUrl: mediaUrl(videoKey)
    });
  }

  return sortSongs(withLocalPreview(catalog));
}

/**
 * Local review of the protected piece: `?preview=fantaisie` in development
 * plays the copy Vite serves from the working directory.
 */
function withLocalPreview(catalog: SongCatalogItem[]): SongCatalogItem[] {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('preview') !== 'fantaisie') return catalog;
  return catalog.map(song => song.id === PROTECTED_SONG_ID ? {
    ...song,
    isOnR2: true,
    videoUrl: `/${encodeURIComponent('Fantaisie-impromptu op 66')}/${encodeURIComponent('fantaisie-tokyo-ghoul-final-720p.mp4')}`
  } : song);
}

/** The catalog as the bundled manifest describes it, available without a request. */
export function localCatalog(): SongCatalogItem[] {
  return buildCatalog(null);
}

/** The catalog checked against R2: missing videos marked, uploaded ones added, live lyrics known. */
export async function loadCatalog(): Promise<SongCatalogItem[]> {
  return buildCatalog(await fetchMediaListing());
}

async function fetchLiveLyrics(songId: string, signal?: AbortSignal): Promise<SongLyricFile | null> {
  try {
    const res = await fetch(`/api/karaoke/lyrics?id=${encodeURIComponent(songId)}`, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return null;
    const data = await res.json() as SongLyricFile | null;
    return data?.lyricsData ? data : null;
  } catch {
    // No overlay endpoint (local development) or the request was aborted; the bundled file is used.
    return null;
  }
}

async function loadBundledLyrics(songId: string): Promise<SongLyricFile | null> {
  const loader = lyricModules[`../data/lyrics/${songId}.json`];
  if (!loader) return null;
  try {
    return await loader();
  } catch (error) {
    console.error(`[catalog] bundled lyrics for "${songId}" failed to load:`, error);
    return null;
  }
}

/** Speaker labels for overlay files saved before the studio recorded them, by song and sung line. */
const SPEAKERS: Record<string, Record<string, string>> = {
  'the-fairly-odd-parents-theme-song': {
    'wands and wings': 'Wanda',
    'floaty crowny things': 'Cosmo'
  }
};

function withSpeakers(file: SongLyricFile, songId: string): SongLyricFile {
  const speakers = SPEAKERS[songId];
  if (!speakers) return file;
  return {
    ...file,
    lyricsData: file.lyricsData.map(verse => {
      if (verse.speaker) return verse;
      const line = verse.words.map(word => word.word).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      return speakers[line] ? { ...verse, speaker: speakers[line] } : verse;
    })
  };
}

/**
 * A song's word and verse timings. A live overlay in R2 wins over the file
 * bundled from git, so a save in the studio shows without a deploy; the two
 * are requested together. `live: false` (the catalog saw no overlay) skips
 * the overlay request.
 */
export async function loadLyrics(songId: string, options: { live?: boolean; signal?: AbortSignal } = {}): Promise<SongLyricFile | null> {
  const [live, bundled] = await Promise.all([
    options.live === false ? null : fetchLiveLyrics(songId, options.signal),
    loadBundledLyrics(songId)
  ]);
  const file = live ?? bundled;
  if (!file) console.warn(`[catalog] no lyrics found for "${songId}"`);
  return file && withSpeakers(file, songId);
}
