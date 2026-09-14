# Standalone Karaoke Engine Blueprint

## 1. Vision & Isolation Strategy

While currently embedded inside the `gewoonthy` Astro/Cloudflare application, the **Karaoke Engine** is architecturally decoupled into pure, portable components:

```
[ Karaoke Engine Standalone ]
  ├── core/
  │   ├── types.ts           <-- Pure TypeScript interfaces
  │   ├── tokenizer.ts       <-- Zero-dependency regex tokenizer & CJK processor
  │   ├── timing.ts          <-- Contract validation & auto-healing algorithms
  │   └── clock.ts           <-- 60 FPS requestAnimationFrame tick manager
  ├── renderer/
  │   ├── dual-line.ts       <-- Alternating look-ahead topological display
  │   ├── syllable-wipe.css  <-- GPU hardware-accelerated clip-path styles
  │   └── backlight.ts       <-- Ambient canvas sampling
  ├── studio/
  │   ├── sync-machine.ts    <-- Spacebar tap-to-sync state machine
  │   └── transport.ts       <-- J/K/L keyboard controls & offset adjustments
  └── server/
      └── sync-daemon.ts     <-- Standalone Node/Bun/Deno local persistence daemon
```

---

## 2. Zero-Dependency Standalone Player Implementation

A minimal standalone implementation can be instantiated in any standard web page or webview in under 100 lines of JavaScript.

### Minimal HTML / CSS Blueprint

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Standalone Karaoke Player</title>
  <style>
    body {
      background: #111;
      color: #fff;
      font-family: 'Noto Sans JP', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px;
    }
    .player-box {
      position: relative;
      width: 800px;
      max-width: 100%;
    }
    video {
      width: 100%;
      border-radius: 8px;
    }
    .lyrics-container {
      margin-top: 16px;
      height: 110px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      font-size: 26px;
      font-weight: bold;
    }
    .k-line {
      width: 100%;
      min-height: 44px;
      display: flex;
      align-items: center;
      transition: opacity 0.2s ease;
    }
    .k-top { justify-content: flex-start; padding-left: 5%; }
    .k-bot { justify-content: flex-end; padding-right: 5%; }
    .k-idle { opacity: 0.55; }
    .k-active { opacity: 1.0; }
    
    /* Dual-Layer Continuous Syllable Wipe */
    .word-wrapper {
      position: relative;
      display: inline-block;
      margin: 0 2px;
    }
    .word-base {
      color: rgba(255, 255, 255, 0.45);
    }
    .word-highlight {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      color: #FF7744;
      text-shadow: 0 0 6px rgba(255, 119, 68, 0.8);
      pointer-events: none;
      clip-path: inset(0 calc(100% - var(--wipe-progress, 0%)) 0 0);
      will-change: clip-path;
    }

    /* Yomitan Ruby Furigana */
    .yomitan-ruby { position: relative; }
    .yomitan-ruby::before {
      content: attr(data-furi);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.5em;
      opacity: 0.85;
    }
  </style>
</head>
<body>
  <div class="player-box">
    <video id="vid" controls src="https://cdn.sudothy.me/VIDEOCLUB%20-%20Roi.mp4"></video>
    <div class="lyrics-container">
      <div id="line-top" class="k-line k-top"></div>
      <div id="line-bot" class="k-line k-bot"></div>
    </div>
  </div>

  <script type="module">
    import { createKaraokeEngine } from './karaoke-engine.js';

    const vid = document.getElementById('vid');
    const lineTop = document.getElementById('line-top');
    const lineBot = document.getElementById('line-bot');

    const res = await fetch('./lyrics.json');
    const songData = await res.json();

    createKaraokeEngine({
      videoElement: vid,
      topLineElement: lineTop,
      bottomLineElement: lineBot,
      lyricsData: songData.lyricsData,
      globalOffset: songData.globalOffset || 0
    });
  </script>
</body>
</html>
```

---

## 3. Pure JavaScript Engine Controller (`karaoke-engine.js`)

```javascript
export function createKaraokeEngine({
  videoElement,
  topLineElement,
  bottomLineElement,
  lyricsData = [],
  globalOffset = 0
}) {
  let currentTop = -2;
  let currentBot = -2;
  let cachedTopWrappers = [];
  let cachedBotWrappers = [];
  let animId = null;

  function buildVerseHTML(verse, key) {
    if (!verse) return '';
    return verse.words.map((w, i) => {
      const display = w.furigana
        ? `<span class="yomitan-ruby" data-furi="${w.furigana}">${w.word}</span>`
        : w.word;
      return `
        <span class="word-wrapper" id="w-${key}-${i}">
          <span class="word-base">${display}</span>
          <span class="word-highlight" aria-hidden="true">${display}</span>
        </span>
      `;
    }).join('');
  }

  function tick() {
    const time = videoElement.currentTime - globalOffset;
    let activeV = -1;
    let upcomingV = -1;

    for (let i = 0; i < lyricsData.length; i++) {
      const v = lyricsData[i];
      if (time >= v.verseStart && time <= v.verseEnd) {
        activeV = i;
        break;
      }
      if (time < v.verseStart) {
        upcomingV = i;
        break;
      }
    }

    const focusV = activeV !== -1 ? activeV : upcomingV;
    let targetTop = -1;
    let targetBot = -1;

    if (focusV !== -1) {
      if (focusV % 2 === 0) {
        targetTop = focusV;
        targetBot = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      } else {
        targetBot = focusV;
        targetTop = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
      }
    }

    // Top line mount
    if (targetTop !== currentTop) {
      currentTop = targetTop;
      topLineElement.innerHTML = targetTop !== -1 ? buildVerseHTML(lyricsData[targetTop], 'top') : '';
      cachedTopWrappers = Array.from(topLineElement.querySelectorAll('.word-wrapper'));
    }

    // Bottom line mount
    if (targetBot !== currentBot) {
      currentBot = targetBot;
      bottomLineElement.innerHTML = targetBot !== -1 ? buildVerseHTML(lyricsData[targetBot], 'bot') : '';
      cachedBotWrappers = Array.from(bottomLineElement.querySelectorAll('.word-wrapper'));
    }

    // Syllable wipe interpolation
    if (targetTop !== -1 && lyricsData[targetTop]) {
      const isActive = targetTop === activeV;
      topLineElement.classList.toggle('k-active', isActive);
      topLineElement.classList.toggle('k-idle', !isActive);

      const words = lyricsData[targetTop].words;
      for (let j = 0; j < words.length; j++) {
        const w = words[j];
        const el = cachedTopWrappers[j];
        if (!el) continue;
        let p = 0;
        if (isActive) {
          if (time >= w.end) p = 100;
          else if (time > w.start && w.end > w.start) {
            p = Math.min(100, Math.max(0, ((time - w.start) / (w.end - w.start)) * 100));
          }
        }
        el.style.setProperty('--wipe-progress', `${p}%`);
      }
    }

    if (targetBot !== -1 && lyricsData[targetBot]) {
      const isActive = targetBot === activeV;
      bottomLineElement.classList.toggle('k-active', isActive);
      bottomLineElement.classList.toggle('k-idle', !isActive);

      const words = lyricsData[targetBot].words;
      for (let j = 0; j < words.length; j++) {
        const w = words[j];
        const el = cachedBotWrappers[j];
        if (!el) continue;
        let p = 0;
        if (isActive) {
          if (time >= w.end) p = 100;
          else if (time > w.start && w.end > w.start) {
            p = Math.min(100, Math.max(0, ((time - w.start) / (w.end - w.start)) * 100));
          }
        }
        el.style.setProperty('--wipe-progress', `${p}%`);
      }
    }

    animId = requestAnimationFrame(tick);
  }

  animId = requestAnimationFrame(tick);

  return {
    destroy: () => cancelAnimationFrame(animId),
    setOffset: (newOffset) => { globalOffset = newOffset; },
    setLyrics: (newLyrics) => {
      lyricsData = newLyrics;
      currentTop = -2;
      currentBot = -2;
    }
  };
}
```

---

## 4. Standalone Microservices & Packaging

1. **NPM Package Target**: `@karaoke/engine` (client player & tokenizer)
2. **CLI Daemon Target**: `karaoke-sync-daemon` (standalone binary compiled via `bun build --compile scripts/sync-server.ts`)
3. **Electron / Desktop**: Can be directly embedded into Tauri or Electron with local MP4 playback from disk, saving directly to local `.json` files without requiring an internet connection.
