# Karaoke Engine Architecture: Subatomic Overview

## 1. System Philosophy & Executive Summary

The **Karaoke Engine** is a high-precision, sub-millisecond, syllable-synchronized multimedia playback and annotation workstation. Originally conceived and engineered within the `gewoonthy` desktop operating system simulator, the engine solves fundamental deficiencies in standard consumer karaoke formats (such as line-level `.lrc` or CPU-intensive `.ass` subtitles) by operating at the **individual phonetic/mora unit level** with continuous GPU-accelerated interpolation.

### Core Architectural Axioms
1. **Phonetic Granularity**: Timing is calculated and rendered at the mora/syllable boundary, not the line or word level.
2. **60 FPS Hardware-Accelerated Interpolation**: Rejects event-driven polling (`timeupdate` fires at ~4 Hz / 250ms) in favor of browser-native `requestAnimationFrame` loops manipulating CSS GPU properties (`clip-path`, CSS custom properties).
3. **Alternating Look-Ahead Topology**: Prevents lyric jumps and cognitive singer disorientation by utilizing a dual-line odd/even flip mechanism with zero blanking intervals.
4. **Resilient Multi-Tier Persistence**: Guarantees zero data loss across local development (Node.js HTTP daemon), edge staging (Cloudflare R2 live overlay), and production permanence (GitHub Contents API commits).
5. **Universal Language Tokenization**: Specialized regular expression state machines handle compound CJK glyphs (拗音, 促音, 長音), ruby annotations (`漢字[ふりがな]`), and agglutinative punctuation absorption.

---

## 2. High-Level Architecture Topology

```
+---------------------------------------------------------------------------------------------------+
|                                      INGESTION & DATA PIPELINE                                    |
|                                                                                                   |
|  Raw Lyrics / LRC Text  ---> [ Tokenizer & NLP Engine ] ---> [ Punctuation Agglomeration ]         |
|  (CJK Ruby / Latin)            (naming.ts)                    (cleanVersePunctuation)             |
|                                                                       |                           |
|                                                                       v                           |
|                                                          Normalized Verse/Word Matrix             |
+-----------------------------------------------------------------------+---------------------------+
                                                                        |
                                                                        v
+---------------------------------------------------------------------------------------------------+
|                                 SYNCHRONIZATION WORKSTATION (STUDIO)                              |
|                                                                                                   |
|  Video Element (Media Clock)  <======>  [ Spacebar Tap Engine ]  <=====> In-Place DOM Word Chips  |
|  - Rate Control (0.5x - 1.25x)            (syncEngine.ts)                - Target Cursor State    |
|  - Micro Offset Steppers (-100ms)         - Word Start/End Bounds        - Auto-Healing Pipeline  |
+-----------------------------------------------------------------------+---------------------------+
                                                                        |
                                         +------------------------------+------------------------------+
                                         | Save Action (Ctrl+S)                                        |
                                         v                                                             v
+------------------------------------------------------------------+  +----------------------------------------------------+
|                TIER 1: LOCAL SYNC SERVER                         |  |            TIER 2: CLOUDFLARE PAGES EDGE                   |
|                (scripts/sync-server.ts)                          |  |            (functions/api/admin/karaoke/save.js)   |
|                                                                  |  |                                                    |
|  Node.js Daemon (localhost:4322)                                 |  |  POST /api/admin/karaoke/save                      |
|  ├─ Contract Validation (validateSongContract)                   |  |  ├─ 1. Instant Overlay -> R2: _lyrics_live/<id>.json|
|  ├─ Atomic File Write -> src/data/lyrics/<id>.json               |  |  └─ 2. Git Commit API -> GitHub Repo (production)  |
|  └─ Manifest Sync -> src/data/songs-manifest.json                |  +----------------------------------------------------+
+------------------------------------------------------------------+                            |
                                         |                                                      v
                                         |                                    +------------------------------------+
                                         |                                    | TIER 3: ZERO-LOSS EXPORT MODAL     |
                                         |                                    | JSON Blob download / Clipboard     |
                                         |                                    +------------------------------------+
                                         v
+---------------------------------------------------------------------------------------------------+
|                                     CLIENT PLAYBACK ENGINE                                        |
|                                                                                                   |
|  Unified Catalog Aggregator (catalog.ts)                                                          |
|  ├─ Static Manifest + R2 Object Discovery                                                         |
|  └─ Fast Dual-Read (R2 Live Overlay -> Static Git Bundle Fallback)                                |
|                                                                                                   |
|  Karaoke Playback Window (KaraokeWindow.js)                                                       |
|  ├─ 60 FPS requestAnimationFrame Tick Loop                                                        |
|  ├─ Dual-Line Alternating Top/Bottom Display                                                      |
|  ├─ Fluid Continuous Syllable Wipe (clip-path: inset)                                             |
|  ├─ Yomitan Ruby Annotation Layer (CSS ::before pseudo-element)                                   |
|  └─ Reactive Dynamic Backlight (Offscreen Canvas 64x64 Subsampled RGB)                            |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Subsystem Breakdown

### Subsystem A: Data Contracts & Mathematical Validation
Governs the strict structural representation of songs, verses, and phonetic words. Enforces mathematical monotonicity where timestamps must satisfy `verseStart <= word.start <= word.end <= verseEnd`. Automatic heuristics heal open or trailing words before schema serialization.
*See [02-data-contracts-and-schemas.md](./02-data-contracts-and-schemas.md).*

### Subsystem B: Tokenizer & CJK NLP Pipeline
Processes unstructured lyrics or timestamped LRC text into phonetic arrays. Employs a zero-dependency unicode regular expression tokenizer tailored for Japanese and non-segmented scripts, handling kanji, hiragana, katakana, compound digraphs, ruby bracket syntax, and isolated punctuation binding.
*See [03-tokenizer-and-nlp-pipeline.md](./03-tokenizer-and-nlp-pipeline.md).*

### Subsystem C: Playback Clock & Rendering Engine
Bypasses the low-frequency browser `timeupdate` event to drive a 60 FPS `requestAnimationFrame` loop. Powers the continuous sub-pixel text fill using CSS `clip-path: inset()` and custom properties. Implements an alternating two-line topological staging system to maximize readability. Includes dynamic canvas-based ambient backlight generation.
*See [04-playback-and-render-engine.md](./04-playback-and-render-engine.md).*

### Subsystem D: Synchronization Workstation
The interactive studio interface (`/admin/karaoke`). Features spacebar tap-to-sync state machines, word-level backspace undo, micro-nudging (±50ms), variable playback speeds (0.5x to 1.25x), scrub timeline block projection, and in-place DOM chip mutation to eliminate layout thrashing.
*See [05-synchronization-studio-workstation.md](./05-synchronization-studio-workstation.md).*

### Subsystem E: Parallel Sync Server & Multi-Tier Persistence
The offline/online dual synchronization pipeline. Uses a lightweight local Node.js daemon (`sync-server.ts`) for zero-latency local development writes, mirrored by a Cloudflare Pages serverless function that performs simultaneous R2 live-overlay writes (0ms playback delay) and background GitHub API commits.
*See [06-sync-server-and-multi-tier-persistence.md](./06-sync-server-and-multi-tier-persistence.md).*

### Subsystem F: Cloud Infrastructure & Catalog Resolution
Direct video upload to Cloudflare R2 (`MEDIA_BUCKET`), CDN edge distribution (`cdn.sudothy.me`), live video/overlay listing discovery, and automated iTunes Search API metadata/artwork resolution.
*See [07-cloud-infrastructure-and-catalog.md](./07-cloud-infrastructure-and-catalog.md).*

### Subsystem G: Standalone Engine Blueprint
A blueprint for extracting this entire architecture into an isolated, zero-dependency package suitable for browser applications, Electron desktop players, or mobile webviews.
*See [08-standalone-engine-blueprint.md](./08-standalone-engine-blueprint.md).*
