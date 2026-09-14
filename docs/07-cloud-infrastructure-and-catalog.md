# Cloud Infrastructure & Catalog Resolution

## 1. Storage & Delivery Architecture

The Karaoke Engine relies on a hybrid static/edge infrastructure designed for zero-egress cost and high throughput:

```
+----------------------------------------------------------------------------------------------------+
|                                    CLOUD INFRASTRUCTURE TOPOLOGY                                   |
|                                                                                                    |
|  [ Content Delivery Network ]                                                                      |
|  https://cdn.sudothy.me/----------------------------------------------+                            |
|                                                                       |                            |
|  [ Cloudflare R2 Bucket: MEDIA_BUCKET ]                               v                            |
|  ├─ Video Assets: "Artist - Title.mp4"                   ───► Public Streaming Delivery            |
|  └─ Live Overlays: "_lyrics_live/<id>.json"              ───► Zero-build instant lyrics overlay    |
|                                                                       ▲                            |
|  [ Cloudflare Pages Functions ]                                       |                            |
|  ├─ GET  /api/karaoke/videos     ── Query R2 Bucket Objects ─────────┤                            |
|  ├─ GET  /api/karaoke/lyrics     ── Read R2 Live Lyric Overlay ───────┤                            |
|  ├─ POST /api/admin/karaoke/save ── Dual-write R2 & GitHub API ───────┘                            |
|  └─ POST /api/admin/karaoke/upload ─ Direct video upload to R2                                     |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Dynamic Catalog Resolution (`catalog.ts`)

In traditional static sites, adding a new song requires committing a video, committing a JSON file, and rebuilding the entire site.

The Karaoke Engine implements a **Unified Catalog Aggregator** (`loadCatalog()`):

```
                        [ loadCatalog() ]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 [ Static Git Manifest ]                 [ Query R2 Bucket ]
 (src/data/songs-manifest.json)          (/api/karaoke/videos)
            │                                     │
            │                                     ├─ Video Keys (e.g. "Song.mp4")
            │                                     └─ Live Overlays (_lyrics_live/<id>.json)
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
            Reconcile & Merge into SongCatalogItem[]:
            1. Registered Git songs checked against R2 presence
            2. Unsynced R2 videos discovered and added to queue
```

### Discovery Logic
1. **Manifest Reconciliation**: For every track in `songs-manifest.json`, check if its `videoFile` exists in R2. If yes, mark `isOnR2 = true, hasLyrics = true`.
2. **Unregistered Media Discovery**: Any video file in R2 that does *not* exist in `songs-manifest.json` is dynamically parsed via `parseSongInfoFromFilename(videoKey)`, given a canonical slug, and inserted into the catalog with `hasLyrics = liveLyricsSet.has(slug)`.
3. In the studio, these appear with a yellow status indicator: `🟡 [NEEDS SYNC]`.

---

## 3. Dual-Read Lyrics Loader (`loadLyrics`)

When the user selects a track in the player, `loadLyrics(songId)` executes an optimized dual-path fetch:

```typescript
export async function loadLyrics(songId: string): Promise<SongLyricFile | null> {
  // Path 1: Check Live Overlay from R2 via Cloudflare Pages endpoint
  try {
    const liveRes = await fetch(`/api/karaoke/lyrics?id=${encodeURIComponent(songId)}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (liveRes.ok) {
      const liveData = await liveRes.json();
      if (liveData && liveData.lyricsData) {
        return liveData as SongLyricFile;
      }
    }
  } catch (_) {
    // Non-blocking fallback to local bundle
  }

  // Path 2: Fallback to static bundled module (Vite lazy-load)
  const targetPath = `../../data/lyrics/${songId}.json`;
  const loader = lyricModules[targetPath];
  if (!loader) return null;
  const module = await loader();
  return ('default' in module) ? module.default : module;
}
```

### Benefits
- **Zero Cache Lag**: If a song was updated in the Studio 5 seconds ago, the client reads the fresh timing immediately from R2 live cache.
- **Offline & Bundled Reliability**: In local development or when R2 is unreachable, the player seamlessly reads from Vite-bundled static JSON files.

---

## 4. iTunes Search API Metadata Resolution (`itunes.ts`)

Instead of requiring manual cover art uploads, the engine queries Apple's iTunes Search API:

$$\text{Search Endpoint: } \texttt{https://itunes.apple.com/search?term=\{term\}\&entity=song\&limit=1}$$

### High-Resolution Resolution Trick
The iTunes Search API returns low-resolution 100x100 thumbnails (`100x100bb.jpg`). The engine performs URL replacement to request uncompressed 600x600 artwork:

```typescript
const highRes = data.results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
imgEl.src = highRes;
```

### Overrides for Non-Latin Tracks
Certain international tracks are indexed differently across English and regional storefronts (e.g. IC3PEAK's "Boo-Hoo" is indexed on Apple Music under its Russian Cyrillic title "Плак-плак"). 

The metadata schema provides `itunesTrack` and `itunesArtist` fields to route the search query to the exact regional title while preserving display metadata.
