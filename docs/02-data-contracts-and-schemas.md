# Data Contracts, Schemas & Validation

## 1. Core Data Models

The Karaoke Engine relies on a hierarchical, immutable timing schema defined in `src/types/karaoke.ts`. The schema descends through three distinct semantic tiers:

```
SongLyricFile (Metadata + Array of Verses)
  └── Verse (Line bounds + Optional translation + Array of Words)
        └── Word (Phonetic token + Start/End timestamps + Optional Furigana)
```

### TypeScript Definitions

```typescript
export interface Word {
  /** The lexical token, syllable, or character. May include trailing whitespace. */
  word: string;
  /** Start timestamp relative to media origin in seconds (e.g. 12.450) */
  start: number;
  /** End timestamp relative to media origin in seconds (e.g. 12.800) */
  end: number;
  /** Optional phonetic reading guide (ruby) rendered over kanji */
  furigana?: string;
}

export interface Verse {
  /** Earliest onset timestamp of the verse block in seconds */
  verseStart: number;
  /** Terminal timestamp after which the verse is unmounted or faded */
  verseEnd: number;
  /** Optional speaker identification (e.g. "Duet A", "Backing Vocal") */
  speaker?: string;
  /** Localized linguistic translation rendered as an auxiliary subtitle */
  translation?: string;
  /** Ordered array of constituent phonetic words */
  words: Word[];
}

export interface SongMetadata {
  /** URL-safe unique slug identifier (e.g. "bmth-go-to-hell") */
  id: string;
  /** Target video filename in Cloudflare R2 bucket (e.g. "Artist - Title.mp4") */
  videoFile: string;
  /** Display title */
  title: string;
  /** Display artist */
  artist: string;
  /** Search override artist for iTunes artwork resolution */
  itunesArtist?: string;
  /** Search override track for iTunes artwork resolution (e.g. Cyrillic) */
  itunesTrack?: string;
  /** Global audio/video sync compensation offset in seconds (signed float) */
  globalOffset: number;
  /** Flag indicating presence of verse translations */
  hasTranslation: boolean;
  /** Flag indicating regional or dialectal vernacular */
  isDialect: boolean;
}

export interface SongLyricFile extends SongMetadata {
  /** Full sequential score of verses */
  lyricsData: Verse[];
}

export interface SongCatalogItem extends SongMetadata {
  /** True if media exists in Cloudflare R2 MEDIA_BUCKET */
  isOnR2: boolean;
  /** True if lyrics JSON exists either in Git bundle or R2 live overlay */
  hasLyrics: boolean;
  /** Fully qualified public HTTPS streaming URL */
  videoUrl: string;
  /** Optional overlay URL */
  lyricsUrl?: string | null;
}
```

---

## 2. Ingestion & Persistence Payload Contracts

When an operator saves lyrics in the studio workstation, the frontend serializes the active state into a `SaveLyricsPayload`:

```typescript
export interface SaveLyricsPayload {
  id: string;
  videoFile: string;
  title: string;
  artist: string;
  itunesArtist?: string;
  itunesTrack?: string;
  globalOffset: number;
  isDialect?: boolean;
  hasTranslation?: boolean;
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

## 3. Mathematical Validation Contract (`validateSongContract`)

To prevent corrupt or disjointed playback, all payloads processed by both client and backend daemons (`naming.ts` and `sync-server.ts`) must pass strict structural invariants:

```typescript
export function validateSongContract(payload: unknown): { valid: boolean; errors: string[] }
```

### Mathematical Invariants

1. **Non-Negativity Constraint**:
   $$\forall w \in \text{Verse.words}, \quad w.\text{start} \ge 0 \quad \land \quad w.\text{end} \ge 0$$
   $$\text{Verse.verseStart} \ge 0 \quad \land \quad \text{Verse.verseEnd} \ge 0$$

2. **Monotonic Temporal Bounding**:
   $$\forall w \in \text{Verse.words}, \quad w.\text{end} \ge w.\text{start}$$
   $$\text{Verse.verseEnd} \ge \text{Verse.verseStart}$$

3. **Identifier URL Safety**:
   $$\text{id} \sim \texttt{/^[a-z0-9\u0080-\uffff\_-]+$/i}$$
   Disallows spaces, path separators (`/`, `\`), query delimiters (`?`, `#`), and shell characters.

4. **Media Extension Enforcement**:
   $$\text{videoFile} \sim \texttt{/\.(mp4|webm|mkv)$/i}$$

---

## 4. The Auto-Healing Pipeline (`persistence.ts`)

During live human synchronization via spacebar tapping, operators naturally stop tapping at the conclusion of a verse, leaving the final word without an explicit end timestamp ($w.\text{end} = 0$).

Before validating and submitting the payload, `buildPayload()` runs an automated healing pass that resolves open intervals:

```typescript
state.localLyrics.forEach((verse) => {
  let maxWordEnd = 0;
  verse.words.forEach((w, idx) => {
    // Condition 1: Word has start time but missing or backwards end time
    if (w.start > 0 && (!w.end || w.end <= w.start)) {
      const next = verse.words[idx + 1];
      if (next && next.start > w.start) {
        // Inherit next word's start time
        w.end = next.start;
      } else if (verse.verseEnd > w.start) {
        // Bound to the verse end
        w.end = verse.verseEnd;
      } else {
        // Fallback: estimate standard syllable duration of 1.5s
        w.end = parseFloat((w.start + 1.5).toFixed(3));
      }
    }
    if (w.end && w.end > maxWordEnd) {
      maxWordEnd = w.end;
    }
  });

  // Condition 2: Auto-bound verse enclosure
  if (verse.words.length > 0) {
    if (verse.verseStart <= 0 && verse.words[0].start > 0) {
      verse.verseStart = verse.words[0].start;
    }
    if (verse.verseEnd <= verse.verseStart) {
      verse.verseEnd = parseFloat((Math.max(verse.verseStart + 1.0, maxWordEnd)).toFixed(3));
    }
  }
});
```

### Auto-Healing Resolution Logic
- If word $i$ lacks an end time, but word $i+1$ has a start time, $w_i.\text{end} \leftarrow w_{i+1}.\text{start}$.
- If word $i$ is the final word of the verse, $w_i.\text{end} \leftarrow \max(w_i.\text{start} + 1.5, \text{verseEnd})$.
- If `verseStart` was unassigned ($0$), it inherits $w_0.\text{start}$.
- `verseEnd` is guaranteed to be at least $\max(\text{verseStart} + 1.0, \max(w.\text{end}))$.
