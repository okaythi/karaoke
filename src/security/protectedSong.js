// Public identifiers only. Never put credentials or source data in this module.
export const PROTECTED_SONG_ID = 'chopin-fantaisie-impromptu';
export const PROTECTED_VIDEO_KEY = 'Frédéric Chopin - Fantaisie-Impromptu, Op. 66.mp4';
export const PROTECTED_MEDIA_PATH = '/api/karaoke/protected/video';
export const isProtectedSong = id => id === PROTECTED_SONG_ID;
export const isProtectedVideo = key => key.normalize('NFC') === PROTECTED_VIDEO_KEY;
