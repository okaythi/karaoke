/**
 * Fetches high-resolution album artwork from the iTunes Search API.
 */
export function fetchAlbumArt(
  artist: string,
  track: string,
  imgEl: HTMLImageElement,
  badgeEl?: HTMLElement
): void {
  imgEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%23111"><rect width="200" height="200"/><circle cx="100" cy="100" r="50" fill="%23222"/></svg>';
  if (badgeEl) badgeEl.textContent = 'Searching iTunes...';

  // Handle known regional alias overrides
  let queryTrack = track;
  if (artist.toLowerCase() === 'ic3peak' && track.toLowerCase() === 'boo-hoo') {
    queryTrack = 'Плак-плак';
  }

  const term = encodeURIComponent(`${artist} ${queryTrack}`);
  fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`)
    .then(res => res.json())
    .then(data => {
      if (data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
        imgEl.src = highRes;
        if (badgeEl) badgeEl.textContent = 'iTunes Match';
      } else {
        if (badgeEl) badgeEl.textContent = 'No Art Found';
      }
    })
    .catch(() => {
      if (badgeEl) badgeEl.textContent = 'Art Offline';
    });
}
