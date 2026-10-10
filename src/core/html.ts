const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string): string => String(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);

/** A link target for markup: http(s) URLs only, anything else is inert. */
export const safeHref = (url: string): string => /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';

/**
 * Lyric text for innerHTML. Lyrics may arrive from the live R2 overlay, so
 * they are escaped; bare emphasis tags are the only markup lyric files use.
 */
export const lyricHtml = (text: string): string =>
  escapeHtml(text).replace(/&lt;(\/?)(i|b|em|strong)&gt;/gi, '<$1$2>');
