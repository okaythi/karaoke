/** Public CDN in front of the media bucket. */
export const MEDIA_ORIGIN = 'https://cdn.sudothy.me';

export const mediaUrl = (key: string): string => `${MEDIA_ORIGIN}/${encodeURIComponent(key)}`;

export const VIDEO_EXTENSION = /\.(mp4|webm|mkv)$/i;
