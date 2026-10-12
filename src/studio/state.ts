import type { StudioState } from './types';

/** The workstation's working copy: one song, its lyrics and the sync cursor. Modules read and write it directly. */
export const state: StudioState = {
  catalog: [],
  currentFilter: 'all',
  activeSong: null,
  localLyrics: [],
  parts: [],
  selectedPart: '*',
  partCursors: {},
  lastStamped: null,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: false,
  globalOffset: 0,
  currentV: 0,
  currentW: 0,
  playbackRate: 1.0,
};
