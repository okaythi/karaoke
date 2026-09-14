# Playback Clock & Rendering Engine

## 1. The Clock Source: `requestAnimationFrame` vs `timeupdate`

In standard HTML5 media players, synchronization is commonly bound to the `<video>` element's `timeupdate` event:

```javascript
// ANTIPATTERN: The low-frequency event approach
video.addEventListener('timeupdate', () => {
  renderLyricProgress(video.currentTime);
});
```

### The Frequency Bottleneck
The HTML5 specification leaves the frequency of `timeupdate` implementation-dependent, typically firing between **3 to 4 times per second** (an interval of 250ms to 330ms). 
At $120\text{ BPM}$, a sixteenth note lasts only $125\text{ms}$. Under `timeupdate`, rapid syllables appear in erratic, stepped batches, completely destroying the visual sync.

### The Subatomic 60 FPS Engine
The Karaoke Engine bypasses `timeupdate` entirely for rendering and initiates a permanent recursive `requestAnimationFrame` render loop:

```javascript
let animationFrameId = null;

const updateLyrics = () => {
  const time = vid.currentTime;
  // Sub-millisecond lyric matching and wipe calculations
  // ...
  animationFrameId = requestAnimationFrame(updateLyrics);
};

animationFrameId = requestAnimationFrame(updateLyrics);
```

By querying `vid.currentTime` at the monitor's native refresh rate (typically 60 Hz or 144 Hz, $\Delta t \approx 16.6\text{ms}$ or $6.9\text{ms}$), visual jitter is eliminated.

---

## 2. Dual-Line Alternating Topological Staging

Standard subtitle rendering systems place one line on screen, clear it when finished, and flash the next line. This causes cognitive whiplash for a singer, as they cannot read upcoming lines during singing or transitions.

The Karaoke Engine implements a **Dual-Line Alternating Display**:

```
+-----------------------------------------------------------------------------------+
|  [ TOP LINE (Left-Aligned, 5% Padding) ]                                          |
|  🟢 Verse 0 (ACTIVE, 100% Opacity, Continuous Wiping...)                         |
+-----------------------------------------------------------------------------------+
|  [ BOTTOM LINE (Right-Aligned, 5% Padding) ]                                      |
|  ⚪ Verse 1 (IDLE, 55% Opacity, Waiting in Staging Queue...)                      |
+-----------------------------------------------------------------------------------+
```

### The Transition Algorithm (`KaraokeWindow.js`)

```javascript
const focusV = activeV !== -1 ? activeV : upcomingV;
let targetTop = -1;
let targetBottom = -1;

if (focusV !== -1 && lyricsData) {
  if (focusV % 2 === 0) {
    // Even verse is Active on Top line
    targetTop = focusV;
    // Odd verse is Pre-Buffered on Bottom line
    targetBottom = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
  } else {
    // Odd verse is Active on Bottom line
    targetBottom = focusV;
    // Top line IMMEDIATELY mounts the NEXT Even verse!
    targetTop = focusV + 1 < lyricsData.length ? focusV + 1 : -1;
  }
}
```

### State Matrix

| Phase | Active Verse | Top Line Content | Top Line State | Bottom Line Content | Bottom Line State |
|---|---|---|---|---|---|
| **Verse 0 Singing** | Verse 0 (Even) | **Verse 0** | `k-line-active` (Opacity 1.0) | **Verse 1** | `k-line-idle` (Opacity 0.55) |
| **Verse 1 Singing** | Verse 1 (Odd) | **Verse 2** (Look-Ahead) | `k-line-idle` (Opacity 0.55) | **Verse 1** | `k-line-active` (Opacity 1.0) |
| **Verse 2 Singing** | Verse 2 (Even) | **Verse 2** | `k-line-active` (Opacity 1.0) | **Verse 3** (Look-Ahead) | `k-line-idle` (Opacity 0.55) |
| **Verse 3 Singing** | Verse 3 (Odd) | **Verse 4** (Look-Ahead) | `k-line-idle` (Opacity 0.55) | **Verse 3** | `k-line-active` (Opacity 1.0) |

The singer always has uninterrupted access to the upcoming verse before they have to sing it.

---

## 3. Fluid Syllable Wipe: The Dual-Layer CSS `clip-path` Architecture

Standard karaoke software often color-codes entire words instantaneously upon onset. The Karaoke Engine produces a continuous, fluid color sweep across each syllable.

### DOM Construction
Every syllable/word is constructed with two identical text layers occupying the same layout space:

```html
<span class="word-wrapper" id="w-top-0">
  <!-- Base layer: Inactive / Dimmed White -->
  <span class="word-base">歌詞</span>
  <!-- Highlight layer: Glowing Orange, Positioned Absolute, Hardware-Clipped -->
  <span class="word-highlight" aria-hidden="true">歌詞</span>
</span>
```

### CSS Implementation
```css
.word-wrapper {
  position: relative;
  display: inline-block;
  vertical-align: baseline;
}

.word-base {
  color: rgba(255, 255, 255, 0.45);
  user-select: none;
}

.word-highlight {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  color: #FF7744;
  text-shadow: 0 0 4px rgba(233, 84, 32, 0.8), 
               0 0 12px rgba(233, 84, 32, 0.4);
  pointer-events: none;
  user-select: none;
  /* Hardware-accelerated dynamic wipe */
  clip-path: inset(0 calc(100% - var(--wipe-progress, 0%)) 0 0);
  will-change: clip-path;
}
```

### Continuous Progress Interpolation Formula
During each tick of `requestAnimationFrame`, for every word in the active verse, the interpolation formula calculates its exact percentage completion:

$$P(t) = \begin{cases} 
0\% & \text{if } t < w.\text{start} \\
100\% & \text{if } t \ge w.\text{end} \\
\displaystyle \frac{t - w.\text{start}}{w.\text{end} - w.\text{start}} \times 100\% & \text{if } w.\text{start} \le t < w.\text{end}
\end{cases}$$

```typescript
let progress = 0;
if (time >= w.end) {
  progress = 100;
} else if (time > w.start && w.end > w.start) {
  progress = Math.min(100, Math.max(0, ((time - w.start) / (w.end - w.start)) * 100));
}
el.style.setProperty('--wipe-progress', `${progress}%`);
```

Because `clip-path: inset()` is executed directly by the browser's compositor thread on the GPU, zero DOM reflow or layout recalculation occurs during playback.

---

## 4. Yomitan Ruby (Furigana) Rendering Layer

Standard HTML `<ruby>` and `<rt>` tags introduce unpredictable line-height stretching and break horizontal baseline alignment. 

The Karaoke Engine uses a CSS pseudo-element architecture:

```html
<span class="yomitan-ruby" data-furi="いの">祈</span>
```

```css
.yomitan-ruby {
  position: relative;
}

.yomitan-ruby::before {
  content: attr(data-furi);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5em;
  line-height: 1;
  margin-bottom: 2px;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  color: inherit;
  opacity: 0.85;
}
```

### Advantage
Because the furigana is rendered via `content: attr(data-furi)`, it is automatically present in both `.word-base` and `.word-highlight`. Consequently, the **furigana wipes in exact unison with the kanji beneath it** without separate timing annotations!

---

## 5. Reactive Dynamic Backlight (Ambient Glow)

To mirror the cinematic ambient lighting found in high-end displays, the player dynamically samples the video stream to illuminate the surrounding container:

```
[ HTML5 Video Element ]
          │
          ▼  (Sampled at 30 FPS via offscreen Canvas)
[ Canvas 64x64 ] ──> Subsample pixel data (stride = 16) ──> Average RGB (r, g, b)
                                                                  │
                                                                  ▼
[ Multi-layer blurred CSS backdrop ] ◄── Assign rgba(r, g, b, alpha)
  ├─ Layer 1: filter: blur(20px), opacity: 0.8
  └─ Layer 2: filter: blur(40px), opacity: 0.6
```

### Throttled Sampling Code
```javascript
const canvas = document.createElement('canvas');
canvas.width = 64;
canvas.height = 64;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Run every 2nd animation frame (30fps) to conserve main-thread CPU
tickCount++;
if (tickCount % 2 === 0) {
  ctx.drawImage(vidEl, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const count = data.length / 16;
  r = Math.floor(r / count);
  g = Math.floor(g / count);
  b = Math.floor(b / count);

  bl1.style.background = `rgba(${r},${g},${b}, 0.5)`;
  bl2.style.background = `rgba(${r},${g},${b}, 0.3)`;
}
```
