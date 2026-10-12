import type { LyricPart, SongCatalogItem, Verse } from '../types/karaoke';

export type FilterMode = 'all' | 'needs_sync' | 'synced';

export interface StudioState {
  catalog: SongCatalogItem[];
  currentFilter: FilterMode;
  activeSong: SongCatalogItem | null;
  localLyrics: Verse[];
  parts: LyricPart[];
  selectedPart: string;
  partCursors: Record<string, { v: number; w: number }>;
  lastStamped: { v: number; w: number } | null;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  globalOffset: number;
  currentV: number;
  currentW: number;
  playbackRate: number;
}
