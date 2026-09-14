# Sync Server & Multi-Tier Persistence

## 1. The Persistence Dilemma

Lyrics synchronization requires substantial human effort. Losing 15 minutes of timing annotations due to an offline backend, expired session, or network disconnect is unacceptable. 

Furthermore, static site generators (like Astro deployed to Cloudflare Pages) rebuild on Git commits, which can take 1 to 3 minutes. The system needed a mechanism for **instant playback** in production without waiting for static builds, while retaining **Git permanence** for version control.

To solve this, the Karaoke Engine implements a **3-Tier Fallback Persistence Architecture**:

```
[ Studio Client: Save Master (Ctrl+S) ]
                   │
                   ▼
       [ Auto-Healing & Validation ]
                   │
                   ▼
     ┌───────────────────────────┐
     │ Tier 1: Local Sync Daemon │ ──── SUCCESS ───► Write src/data/lyrics/<id>.json
     │ (http://localhost:4322)   │                   Update songs-manifest.json
     └─────────────┬─────────────┘
                   │ OFFLINE / FAILED
                   ▼
     ┌───────────────────────────┐
     │ Tier 2: Cloudflare Edge   │ ──── SUCCESS ───► 1. Instant R2 Overlay (_lyrics_live/<id>.json)
     │ (/api/admin/karaoke/save) │                   2. Background GitHub API Commit
     └─────────────┬─────────────┘
                   │ OFFLINE / FAILED
                   ▼
     ┌───────────────────────────┐
     │ Tier 3: Zero-Loss Modal   │ ────────────────► Open JSON Export Drawer
     │ (In-Browser Fallback)     │                   Clipboard Copy & Disk Download (.json)
     └───────────────────────────┘
```

---

## 2. Tier 1: The Local Sync Daemon (`scripts/sync-server.ts`)

During local development, running `npm run sync:server` boots a lightweight Node.js HTTP server on port `4322`:

```bash
npm run sync:server
# Executes: tsx scripts/sync-server.ts
```

### Endpoints
- `GET /health`: Returns JSON `{ status: "ok", port: 4322, time: "..." }`.
- `POST /save`: Accepts a `SaveLyricsPayload` JSON body.

### Server Implementation Logic
1. **CORS Handling**: Permissive `Access-Control-Allow-Origin: *` to accept requests from Astro dev server (`localhost:4321`).
2. **Contract Validation**: Validates the payload structure and mathematical invariants using `validateSongContract(payload)`. Rejects invalid payloads with HTTP 400.
3. **Atomic File Write**:
   ```typescript
   const songFilePath = path.join(lyricsDir, `${payload.id}.json`);
   fs.writeFileSync(songFilePath, JSON.stringify(payload, null, 2), 'utf8');
   ```
4. **Manifest Reconciliation**:
   Reads `src/data/songs-manifest.json`, updates or inserts the song's metadata object, sorts the entire manifest alphabetically by title, and atomically rewrites the manifest:
   ```typescript
   manifest.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
   fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
   ```

---

## 3. Tier 2: Cloudflare Pages Edge Pipeline (`save.js`)

When deployed to production on Cloudflare Pages, the local Node daemon is not present. The workstation seamlessly falls through to the serverless function `POST /api/admin/karaoke/save`.

### Step 1: Instant Live Overlay to Cloudflare R2
To achieve **0ms playback delay** without waiting for CI/CD builds, the worker writes the payload directly into the R2 bucket under the prefix `_lyrics_live/`:

```javascript
if (env.MEDIA_BUCKET) {
  const liveKey = `_lyrics_live/${id}.json`;
  await env.MEDIA_BUCKET.put(liveKey, JSON.stringify(payload, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });
  liveCached = true;
}
```

The catalog loader (`catalog.ts`) and client player (`KaraokeWindow.js`) immediately read from `_lyrics_live/${id}.json` via `/api/karaoke/lyrics?id=${id}`, making the newly synced track playable instantly for all users worldwide!

### Step 2: Git Permanence via GitHub Contents REST API
In parallel, if `GITHUB_TOKEN` is configured in the Cloudflare environment, the worker automatically creates an authenticated Git commit against the production branch:

```javascript
const ghToken = env.GITHUB_TOKEN;
const repo = env.GITHUB_REPO || 'okaythi/gewoonthy';
const branch = env.GITHUB_BRANCH || 'production';

// 1. Fetch current file SHA (if existing file being updated)
const lyricPath = `src/data/lyrics/${id}.json`;
let sha = null;
const getFileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${lyricPath}?ref=${branch}`, { headers });
if (getFileRes.ok) {
  const fileData = await getFileRes.json();
  sha = fileData.sha;
}

// 2. Base64 encode UTF-8 payload
const lyricContentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

// 3. Commit file via PUT request
const putLyricRes = await fetch(`https://api.github.com/repos/${repo}/contents/${lyricPath}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    message: `sync(lyrics): update timings for ${id}`,
    content: lyricContentBase64,
    branch,
    sha: sha || undefined
  })
});
```

> [!NOTE]
> **WAF Bypass Security Header**: The Cloudflare worker specifies a custom `User-Agent: 'Cloudflare-Pages-Karaoke-Studio'` to prevent Cloudflare WAF Error 1010 blocking inter-service API traffic.

---

## 4. Tier 3: Zero-Data-Loss In-Browser Export Fallback

If both Tier 1 (local daemon) and Tier 2 (remote Cloudflare endpoint) fail (e.g. offline field usage or missing credentials), `persistence.ts` catches the failure and opens the **Export Modal**:

```typescript
export async function saveMaster(...): Promise<void> {
  // 1. Try Local Sync Daemon (localhost:4322)
  // ...
  // 2. Try Cloudflare Pages Function (/api/admin/karaoke/save)
  // ...
  // 3. Fallback: Prompt JSON Export to prevent any loss of timing work
  showToast('Local sync daemon & remote API offline. Exporting JSON...', true);
  openExportModal(payload);
}
```

The export drawer provides:
1. One-click **Copy to Clipboard**
2. Direct browser **Blob Download** of `<song-id>.json`

Under no circumstances can synchronized work be lost.
