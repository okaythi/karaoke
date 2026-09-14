# Karaoke Engine Documentation Index

Welcome to the subatomic technical documentation for the **Karaoke Engine** and its parallel **Sync Server** ecosystem.

## Documentation Suite

1. **[01. System Architecture Overview](./01-architecture-overview.md)**
   - Executive summary, foundational axioms, and macro system topologies.
   - End-to-end data pipeline from raw ingestion to 60 FPS playback.

2. **[02. Data Contracts, Schemas & Validation](./02-data-contracts-and-schemas.md)**
   - Subatomic schema specifications: `Word`, `Verse`, `SongMetadata`, `SongLyricFile`, and `SaveLyricsPayload`.
   - Mathematical validation invariants and the automated healing pipeline.

3. **[03. Tokenizer & Japanese CJK NLP Pipeline](./03-tokenizer-and-nlp-pipeline.md)**
   - Master CJK regular expression tokenizer.
   - Compound mora grouping (拗音, 促音, 長音) and ruby bracket parsing (`漢字[ふりがな]`).
   - Punctuation agglomeration algorithm (`cleanVersePunctuation`).
   - LRC import format specification and conversion formulas.

4. **[04. Playback Clock & Rendering Engine](./04-playback-and-render-engine.md)**
   - 60 FPS `requestAnimationFrame` tick loop bypassing `timeupdate` jitter.
   - Alternating two-line look-ahead staging topology with zero blanking intervals.
   - Dual-layer CSS `clip-path: inset()` continuous fluid syllable wipe.
   - Yomitan Ruby (furigana) styling with CSS pseudo-elements.
   - Ambient dynamic backlight generation via offscreen 64x64 canvas subsampling.

5. **[05. Synchronization Studio Workstation](./05-synchronization-studio-workstation.md)**
   - Interactive administrative workstation interface (`/admin/karaoke`).
   - Spacebar tap-to-sync state machine and $(V, W)$ target cursor mechanics.
   - In-place DOM chip mutation vs layout thrashing prevention.
   - Keyboard command matrix, variable playback rates, and micro-offset steppers.

6. **[06. Sync Server & Multi-Tier Persistence](./06-sync-server-and-multi-tier-persistence.md)**
   - The parallel local Node.js sync server (`scripts/sync-server.ts`).
   - Atomic file writes and manifest reconciliation.
   - Cloudflare Pages serverless edge save endpoint (`functions/api/admin/karaoke/save.js`).
   - Dual-write architecture: Instant R2 live overlay cache (0ms playback delay) + GitHub REST API commits.
   - Zero-data-loss in-browser export fallback.

7. **[07. Cloud Infrastructure & Catalog Resolution](./07-cloud-infrastructure-and-catalog.md)**
   - Cloudflare R2 bucket bindings (`MEDIA_BUCKET`) and CDN distribution (`cdn.sudothy.me`).
   - Unified catalog aggregator (`loadCatalog()`) reconciling Git manifests with live R2 video discovery.
   - Fast dual-read lyrics loader (`loadLyrics()`).
   - iTunes Search API metadata and high-resolution artwork resolution.

8. **[08. Standalone Engine Blueprint](./08-standalone-engine-blueprint.md)**
   - Decoupled modular architecture specification.
   - Ready-to-run zero-dependency standalone HTML/JS player blueprint.
   - Standalone microservices and packaging roadmap.
