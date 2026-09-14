# 02. Data Contracts, Schemas & Validation Pipeline

> Detailed specifications for TypeScript interfaces, mathematical validation contracts, timing auto-healing algorithms, Cloudflare D1 SQL schemas, and type-level branded identities.

---

## 📐 Canonical TypeScript Interfaces

All karaoke domain models are defined in [`src/types/karaoke.ts`](file:///home/thy/Projects/%E3%82%AB%E3%83%A9%E3%82%AA%E3%82%B1/src/types/karaoke.ts) and enforce strict, immutable structures throughout the synchronization and rendering lifecycle.

### 1. Atomic Timing Primitives: `Word` & `Verse`

```typescript
export interface Word {
  /** The textual glyph, syllable, or phonetic word segment */
  word: string;
  /** Floating-point timestamp in seconds when the vocal syllable starts */
  start: number;
  /** Floating-point timestamp in seconds when the vocal syllable ends */
  end: number;
  /** Optional phonetic furigana reading (Kana) for Japanese Kanji */
  furigana?: string;
}

export interface Verse {
  /** Timestamp when the verse line becomes active/visible (seconds) */
  verseStart: number;
  /** Timestamp when the verse line concludes/fades out (seconds) */
  verseEnd: number;
  /** Optional speaker tag for duet or multi-singer tracks */
  speaker?: string;
  /** Optional localized translation subtitle rendered below the verse */
  translation?: string;
  /** Chronologically ordered array of phonetic word syllables */
  words: Word[];
}
```

### 2. Catalog & Metadata Models

```typescript
export interface SupportItem {
  itemName: string;
  itemLink: string;
}

export interface SongMetadata {
  /** Deterministic URL-safe slug (e.g. "ic3peak-boo-hoo") */
  id: string;
  /** Canonical video filename in R2 storage (e.g. "IC3PEAK - Boo-Hoo.mp4") */
  videoFile: string;
  /** Display title */
  title: string;
  /** Display artist */
  artist: string;
  /** Optional artist override optimized for iTunes Search API */
  itunesArtist?: string;
  /** Optional track title override for iTunes Search API (e.g. Cyrillic title) */
  itunesTrack?: string;
  /** Optional country storefront code (e.g. "jp", "no", "fr", "us") */
  itunesCountry?: string;
  /** Optional manual phonetic sorting title */
  sortTitle?: string;
  /** Explicit album artwork override URL (bypasses iTunes API) */
  coverUrl?: string;
  /** Global timing offset in seconds added/subtracted from currentTime */
  globalOffset: number;
  /** Whether the track includes localized translation subtitles */
  hasTranslation: boolean;
  /** Whether lyrics use regional dialect or non-standard vernacular */
  isDialect: boolean;
  /** Optional support toggle or custom link list */
  support?: boolean | SupportItem[];
  /** Structured array of patronage links (Bandcamp, Patreon, etc.) */
  supportItems?: SupportItem[];
  /** Unique 6-character alphanumeric shortlink code (e.g. "tw0aCO") */
  shareCode?: string;
}

export interface SongLyricFile extends SongMetadata {
  /** Complete array of synchronized verses */
  lyricsData: Verse[];
}

export interface SongCatalogItem extends SongMetadata {
  /** Whether the corresponding video file is present in Cloudflare R2 */
  isOnR2: boolean;
  /** Whether synchronized lyrics JSON exists (in Git or live overlay) */
  hasLyrics: boolean;
  /** Fully qualified CDN URL to the media stream */
  videoUrl: string;
  /** Optional URL to dynamic remote lyrics */
  lyricsUrl?: string | null;
}
```

### 3. API Communication Payloads

```typescript
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
  support?: boolean | SupportItem[];
  supportItems?: SupportItem[];
  shareCode?: string;
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
```

---

## 🛡️ Mathematical Validation Contract

To guarantee that corrupt data or malformed timestamps never break the 60 FPS presentation render loop, every lyric file submitted to the local daemon or the Cloudflare Pages save endpoint is validated against strict mathematical invariants via `validateSongContract()` ([`src/core/contracts.ts`](file:///home/thy/Projects/%E3%82%AB%E3%83%A9%E3%82%AA%E3%82%B1/src/core/contracts.ts)):

```typescript
export function validateSongContract(payload: unknown): { valid: boolean; errors: string[] }
```

### Invariants Enforced

| Property | Invariant Rule | Rationale |
| :--- | :--- | :--- |
| `payload` | Must be a non-null object | Guards against null/undefined JSON parsing failures. |
| `id` | Non-empty, matching `/^[a-z0-9\u0080-\uffff_-]+$/i` | Prevents path traversal vulnerabilities and ensures URL-safe query params. |
| `videoFile` | Non-empty, ending in `.mp4`, `.webm`, or `.mkv` | Guarantees supported HTML5 video container formats. |
| `title`, `artist` | Non-empty, trimmed strings | Prevents unnamed entities in search and sidebar rendering. |
| `globalOffset` | `typeof === 'number'` and `!isNaN(globalOffset)` | Prevents calculation corruption during render loop timestamp offsets. |
| `lyricsData` | `Array.isArray(lyricsData)` | Requires verse collection. |
| `verse.verseStart` | `number >= 0` and not `NaN` | Video time cannot be negative. |
| `verse.verseEnd` | `number >= verseStart` and not `NaN` | Negative duration verses are mathematically invalid. |
| `verse.words` | Must be an array | Requires word collection. |
| `word.word` | Must be a string | Display glyph requirement. |
| `word.start` | `number >= 0` and not `NaN` | Syllable onset must be non-negative. |
| `word.end` | `number >= word.start` and not `NaN` | Syllable duration cannot be negative ($end - start \ge 0$). |

---

## 🩹 Timing Auto-Healing Pipeline

Human synchronizers frequently tap the start of words but may forget to explicitly tap word endpoints, particularly at the end of verses. If unhandled, this leaves `w.end <= w.start` or `w.end === 0`, causing the rendering engine to render instantaneous wipes or infinite stalls.

The `autoHealTimings()` function ([`src/core/contracts.ts`](file:///home/thy/Projects/%E3%82%AB%E3%83%A9%E3%82%AA%E3%82%B1/src/core/contracts.ts)) runs immediately prior to validation:

```typescript
export function autoHealTimings(verses: Verse[]): Verse[]
```

### Auto-Healing Algorithm
1. **Inner Syllable Duration Profiling**:
   $$\overline{D}_{\text{syllable}} = \frac{1}{N} \sum_{j=0}^{N-1} (w_{j}.\text{end} - w_{j}.\text{start}) \quad \text{for } 0.05\text{s} < D < 4.0\text{s}$$
   If no valid inner words exist, a fallback average duration of $0.4\text{s}$ is assumed.
2. **Intermediate Unclosed Words**:
   If an inner word has $start > 0$ and $end \le start$, its end is snapped to the start of the immediate next word ($w_{j}.\text{end} = w_{j+1}.\text{start}$).
3. **Verse-Final Unclosed Words (Natural Vocal Hold)**:
   For the final word of a verse, closing is computed using a natural musical hold:
   $$H_{\text{natural}} = \max(0.8\text{s}, \min(1.8\text{s}, \overline{D}_{\text{syllable}} \times 2.0))$$
   $$w_{\text{final}}.\text{end} = w_{\text{final}}.\text{start} + \min(H_{\text{natural}}, \text{nextVerseStart} - w_{\text{final}}.\text{start})$$
4. **Verse Boundaries Calibration**:
   - `verseStart` defaults to the first word's start time if unset.
   - `verseEnd` is sealed at $\max(\text{maxWordEnd} + 0.4\text{s}, \text{verseStart} + 0.5\text{s})$, but strictly bounded by the start of the subsequent verse to prevent overlap.

---

## 🗄️ Cloudflare D1 SQLite Schemas

Dynamic features—anonymous identity mapping, song ratings, view metrics, and dynamic 6-character shortlinks—are stored in a serverless Cloudflare D1 database (`system_data`):

```sql
-- 1. Dynamic Shortlinks Table (Functions: [code].js, api/admin/karaoke/upload.js)
CREATE TABLE IF NOT EXISTS song_links (
    code TEXT PRIMARY KEY,          -- Unique 6-character code (e.g. 'tw0aCO')
    song_id TEXT NOT NULL,          -- Slug ID matching src/data/lyrics/<id>.json
    file_name TEXT NOT NULL         -- Exact R2 video key
);
CREATE INDEX IF NOT EXISTS idx_song_links_song_id ON song_links(song_id);
CREATE INDEX IF NOT EXISTS idx_song_links_file_name ON song_links(file_name);

-- 2. Aggregate Song Metrics Table (Functions: api/vote.js)
CREATE TABLE IF NOT EXISTS song_votes (
    file_name TEXT PRIMARY KEY,     -- Exact R2 video key
    likes INTEGER DEFAULT 0,        -- Total positive votes
    dislikes INTEGER DEFAULT 0,     -- Total negative votes
    views INTEGER DEFAULT 0         -- Genuine plays exceeding 5.47 seconds
);

-- 3. Individual User Votes (Functions: api/vote.js)
CREATE TABLE IF NOT EXISTS user_song_votes (
    username TEXT NULL,             -- Username if authenticated session exists
    file_name TEXT NOT NULL,        -- Target video key
    action TEXT NOT NULL,           -- 'like' or 'dislike'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    kr_id TEXT NULL                 -- Passive anonymous identity (e.g. 'kr-A8F2-99B1')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_song_votes_session 
    ON user_song_votes(username, file_name) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_song_votes_krid 
    ON user_song_votes(kr_id, file_name) WHERE kr_id IS NOT NULL;

-- 4. Anonymous User Fingerprint Registry (Functions: api/fingerprint.ts)
CREATE TABLE IF NOT EXISTS anonymous_users (
    kr_id TEXT PRIMARY KEY,         -- Formatted 'kr-XXXX-XXXX'
    fp_hash TEXT UNIQUE NOT NULL,   -- SHA-256 hex string of client + server entropy
    views INTEGER DEFAULT 0,        -- Individual view counter
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_anon_users_fphash ON anonymous_users(fp_hash);
```

---

## 🔒 Compile-Time Branded Types: `kr-ID`

To prevent arbitrary, unsanitized strings from being passed into database queries expecting validated anonymous user identifiers, the system enforces branded types and recursive type-level template matching ([`src/fingerprint/kr-id.ts`](file:///home/thy/Projects/%E3%82%AB%E3%83%A9%E3%82%AA%E3%82%B1/src/fingerprint/kr-id.ts)):

```typescript
type UpperAlphanumChar =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L'
  | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X'
  | 'Y' | 'Z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

type ExactChars<S extends string, N extends number, Acc extends string = ''> =
  Acc extends { length: N } ? (S extends '' ? Acc : never)
  : S extends `${UpperAlphanumChar}${infer Rest}`
    ? S extends `${infer C}${Rest}`
      ? ExactChars<Rest, N, `${Acc}${C}`>
      : never
    : never;

/** Compile-time validation: strictly matches /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/ */
export type ValidateKrId<T extends string> =
  T extends `kr-${infer A}-${infer B}`
    ? ExactChars<A, 4> extends never ? never
    : ExactChars<B, 4> extends never ? never
    : T
    : never;

/** Branded nominal type */
export type UserId<T extends string = string> = { readonly id: T };

export function createUserId<T extends string>(id: ValidateKrId<T>): UserId<T> {
  return { id } as UserId<T>;
}
```

### Deterministic Byte Encoding
When generating a `kr-ID` from cryptographic entropy, the first 8 bytes of the SHA-256 hash are mapped into a Base36 alphanumeric string:

$$\text{char}_i = \text{CHARS}[\text{byte}_i \pmod{36}]$$

Yielding $36^8 \approx 2.81 \times 10^{12}$ unique permutations formatted as `kr-XXXX-XXXX`.
