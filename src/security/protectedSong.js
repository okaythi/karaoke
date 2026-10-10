// Public identifiers only. Never put credentials or source data in this module.
// Plain JavaScript because the origin-guard worker imports it without a build step.
export const PROTECTED_SONG_ID = 'chopin-fantaisie-impromptu';
export const PROTECTED_VIDEO_KEY = 'Frédéric Chopin - Fantaisie-Impromptu, Op. 66.mp4';
export const PROTECTED_SCORE_KEY = 'fantaisie/runtime-score.json';
export const PROTECTED_MEDIA_PATH = '/api/karaoke/protected/video';
/** Turnstile action the widget requests and the server verifies. */
export const PLAYBACK_ACTION = 'fantaisie_playback';
/** @param {string} id */
export const isProtectedSong = id => id === PROTECTED_SONG_ID;
/** @param {string} key */
export const isProtectedVideo = key => key.normalize('NFC') === PROTECTED_VIDEO_KEY;
