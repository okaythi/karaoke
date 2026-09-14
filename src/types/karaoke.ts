export interface Word {
  word: string;
  start: number;
  end: number;
  furigana?: string;
}

export interface Verse {
  verseStart: number;
  verseEnd: number;
  speaker?: string;
  translation?: string;
  words: Word[];
}

export interface SongMetadata {
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
  hasTranslation: boolean;
  isDialect: boolean;
}

export interface SongLyricFile extends SongMetadata {
  lyricsData: Verse[];
}

export interface SongCatalogItem extends SongMetadata {
  isOnR2: boolean;
  hasLyrics: boolean;
  videoUrl: string;
  lyricsUrl?: string | null;
}

export interface SaveLyricsPayload {
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
  lyricsData: Verse[];
}

export interface SaveLyricsResponse {
  success: boolean;
  id: string;
  filePath?: string;
  liveCached?: boolean;
  githubCommitted?: boolean;
  githubError?: string | null;
  error?: string;
}

export interface R2VideoItem {
  key: string;
  size?: number;
  uploaded?: string;
}
