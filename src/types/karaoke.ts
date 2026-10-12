export interface Word {
  word: string;
  start: number;
  end: number;
  /** Explicit false distinguishes an untimed import from a word starting at zero. */
  timed?: boolean;
  /** The editor must preserve an explicitly recorded end when estimating timings. */
  endLocked?: boolean;
  furigana?: string;
}

export interface Verse {
  verseStart: number;
  verseEnd: number;
  speaker?: string;
  /** Shared words with identical timing; independent vocals remain separate verses. */
  speakers?: string[];
  translation?: string;
  words: Word[];
}

export interface LyricPart {
  id: string;
  name: string;
  color: string;
}

export interface SupportItem {
  itemName: string;
  itemLink: string;
}

export interface SongMetadata {
  id: string;
  videoFile: string;
  /** Instrumental piece whose primary content is its synchronized score. */
  scoreOnly?: boolean;
  title: string;
  artist: string;
  language?: string;
  itunesArtist?: string;
  itunesTrack?: string;
  itunesCountry?: string;
  sortTitle?: string;
  coverUrl?: string;
  globalOffset: number;
  hasTranslation: boolean;
  isDialect: boolean;
  instrumentalFile?: string;
  support?: boolean | SupportItem[];
  supportItems?: SupportItem[];
  shareCode?: string;
}

export interface SongLyricFile extends SongMetadata {
  parts?: LyricPart[];
  lyricsData: Verse[];
}

export interface SongCatalogItem extends SongMetadata {
  isOnR2: boolean;
  hasLyrics: boolean;
  /** Whether R2 holds a live lyric overlay; undefined when R2 could not be listed. */
  hasLiveLyrics?: boolean;
  videoUrl: string;
  instrumentalUrl?: string | null;
}

export interface SaveLyricsPayload {
  parts?: LyricPart[];
  id: string;
  videoFile: string;
  title: string;
  artist: string;
  itunesArtist?: string;
  itunesTrack?: string;
  itunesCountry?: string;
  sortTitle?: string;
  coverUrl?: string;
  globalOffset: number;
  isDialect?: boolean;
  hasTranslation?: boolean;
  support?: boolean | SupportItem[];
  supportItems?: SupportItem[];
  shareCode?: string;
  lyricsData: Verse[];
}

export interface R2VideoItem {
  key: string;
  size?: number;
  uploaded?: string;
}
