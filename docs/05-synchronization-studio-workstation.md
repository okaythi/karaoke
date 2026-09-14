# Synchronization Studio Workstation

## 1. Studio Architecture & User Interface

The synchronization studio (`/admin/karaoke`) is an administrative workstation designed for high-throughput, keyboard-first lyrics synchronization. It replaces cumbersome visual timeline dragging with a rhythm-game tap-to-sync mechanic.

```
+---------------------------------------------------------------------------------------------------------+
| TOP CONTROL DECK: Brand | Inspector Toggle | + Upload | Filter Tabs | Track Selector | Timecode | Save  |
+----------------------------------------------------+----------------------------------------------------+
| LEFT INSPECTOR PANEL (300px)                       | CENTER MONITOR & SCRUBBER (Flex 1)                 |
| ├─ Track Artwork (iTunes Match)                    | ├─ Video Monitor with Live Active HUD              |
| ├─ Synchronization Progress Bar & Telemetry        | ├─ Scrubber Track with Rendered Verse Blocks       |
| ├─ Song Metadata (Title, Artist, Slugs, Flags)     | ├─ Transport Controls (J, K, L, Play/Pause)        |
| └─ Save & Commit Master Button                     | ├─ Playback Rate (0.5x, 0.75x, 1.0x, 1.25x)        |
|                                                    | └─ Micro-Offset Steppers (-100ms, -50ms, +50ms)    |
+----------------------------------------------------+----------------------------------------------------+
| RIGHT TIMING MATRIX PANEL (380px)                                                                       |
| ├─ Ingest Raw / LRC Button | + Add Verse Button                                                         |
| └─ Scrollable Verse Cards with Interactive Word Chips (Target cursor, timing badges, delete, edit)      |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Tap-to-Sync State Machine (`syncEngine.ts`)

The operator initiates playback of the music video, focuses the `#matrix-pane`, and taps the `Spacebar` on each syllable as it is vocalized by the singer.

### The Cursor Tuple: $(V, W)$
The workstation state tracks the active synchronization target:
- $V \in [0, N-1]$: Current verse index
- $W \in [0, M-1]$: Current word index within verse $V$

```
[ Spacebar Event Triggered ]
             │
             ▼
  Calculate current timecode:
  time = vid.currentTime - state.globalOffset
             │
             ├───────────────────────────────────────────────────────┐
             ▼                                                       ▼
  1. Stamp Word Start:                                    2. If W === 0 (First Word):
  verse.words[W].start = Math.max(0, time)                verse.verseStart = Math.max(0, time)
             │                                                       │
             ├───────────────────────────────────────────────────────┘
             ▼
  3. Close Previous Word End Timestamp:
     ├─ If W > 0: verse.words[W - 1].end = time
     └─ If W === 0 and V > 0: prevVerse.words[last].end = time; prevVerse.verseEnd = time
             │
             ▼
  4. Advance Target Cursor:
     W = W + 1
     ├─ If W >= verse.words.length:
     │    verse.words[W-1].end = time + 1.5
     │    verse.verseEnd = time + 2.0
     │    W = 0
     │    V = V + 1
             │
             ▼
  5. Auto-Skip Punctuation:
     While current word matches ALL_PUNCT_REGEX:
        Advance W (and V if overflow)
             │
             ▼
  6. In-Place DOM Mutation:
     ├─ If V did not change: Mutate #chip-V-W class and textContent directly
     └─ If V changed: Full renderMatrix() + smooth scroll to card-v-V
```

### In-Place DOM Mutation vs Layout Thrashing
Re-rendering all 50+ verse cards on every spacebar press causes severe frame drops and keyboard input lag. 
The sync engine resolves this by performing **in-place DOM mutation** as long as synchronization remains within the current verse:

```typescript
// Sub-millisecond DOM update without full re-render
const stampedChip = document.getElementById(`chip-${stampedV}-${stampedW}`);
if (stampedChip) {
  stampedChip.classList.add('timed');
  stampedChip.classList.remove('target-next');
  const tsEl = stampedChip.querySelector('.word-timestamp');
  if (tsEl) tsEl.textContent = `${time.toFixed(2)}s`;
}

const nextChip = document.getElementById(`chip-${state.currentV}-${state.currentW}`);
if (nextChip) {
  nextChip.classList.add('target-next');
}
```
Only when transitioning from verse $V$ to verse $V+1$ is a full card switch and container auto-scroll triggered.

---

## 3. Workstation Keyboard Shortcut Command Table

| Keybinding | Scope | Function | Implementation Details |
|---|---|---|---|
| `Space` | Matrix Pane | **Stamp Word & Advance** | Records `currentTime - globalOffset`, closes previous word, moves $(V, W) \to (V, W+1)$. |
| `Backspace` | Matrix Pane | **Undo / Wipe Word** | Decrements $(V, W) \to (V, W-1)$ and resets `start = 0, end = 0`. |
| `Shift + Backspace` | Matrix Pane | **Delete Verse** | Splices `state.localLyrics[V]` from array and updates telemetry. |
| `Tab` | Matrix Pane | **Advance Word Cursor** | Moves target highlight to next word without altering timing values. |
| `Shift + Tab` | Matrix Pane | **Previous Word Cursor** | Moves target highlight to previous word without altering timing values. |
| `[` / `]` | Matrix Pane | **Micro-Nudge Timing** | Shifts active word timestamp by $-50\text{ms}$ or $+50\text{ms}$ for micro-fine tuning. |
| `K` | Global Window | **Toggle Play / Pause** | Toggles `<video>` playback without losing matrix focus. |
| `J` | Global Window | **Seek Backward 2s** | `vid.currentTime = Math.max(0, vid.currentTime - 2)` |
| `L` | Global Window | **Seek Forward 2s** | `vid.currentTime = Math.min(vid.duration, vid.currentTime + 2)` |
| `Ctrl + S` / `Cmd + S`| Global Window | **Save Master** | Triggers multi-tier save pipeline (`saveMaster`). |
| `?` | Global Window | **Help Modal** | Opens the keyboard shortcuts modal drawer. |

---

## 4. Playback Speed & Global Offset Steppers

### Variable Playback Rates
Syncing fast-paced verses (e.g. rapid hip-hop or hyperpop) is challenging at $1.0\times$ speed. The studio allows adjusting playback speed dynamically:
- `0.5x` (Half-Speed)
- `0.75x` (Slowed)
- `1.0x` (Normal)
- `1.25x` (Accelerated)

HTML5 video preserves audio pitch during playback rate changes, allowing operators to sync words with millisecond precision at $0.5\times$.

### Global Compensation Offset
Due to audio encoding latency or video container container padding, some media files have a fixed delay. The studio features stepper buttons for `globalOffset`:
- `-100ms`, `-50ms`, `+50ms`, `+100ms`

$$\text{effectiveTime} = \text{vid.currentTime} - \text{state.globalOffset}$$

---

## 5. Telemetry & Timeline Block Projection

### Live Telemetry Aggregation
```typescript
let totalWords = 0;
let timedWords = 0;

state.localLyrics.forEach(v => {
  v.words.forEach(w => {
    totalWords++;
    if (w.start > 0 || (w.end && w.end > 0)) {
      timedWords++;
    }
  });
});

const pct = totalWords > 0 ? Math.round((timedWords / totalWords) * 100) : 0;
els.syncProgressFill.style.width = `${pct}%`;
els.statsWordsTimed.textContent = `${timedWords} / ${totalWords} (${pct}%)`;
els.statsVersesCount.textContent = String(state.localLyrics.length);
```

### Scrubber Verse Blocks
The timeline scrubber visually renders where all synced verses sit along the track's duration:

$$\text{leftPct} = \frac{\text{verseStart}}{\text{duration}} \times 100\%, \quad \text{widthPct} = \max\left(0.5\%, \frac{\text{verseEnd} - \text{verseStart}}{\text{duration}} \times 100\%\right)$$
