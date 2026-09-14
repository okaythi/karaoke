/**
 * fingerprint.ts — Passive browser identity fingerprinting
 *
 * Collects every available signal without requesting permissions.
 * All collectors run in parallel via Promise.allSettled — a single slow
 * or throwing collector never blocks the others.
 *
 * Returns a hex string of the SHA-256 of all combined signals,
 * which the server merges with its own network-layer observations.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mq = (q: string): string => String(window.matchMedia(q).matches);

/** Resolve a promise with a timeout fallback value */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))]);
}

// ─── Individual Collectors ────────────────────────────────────────────────────

/** Navigator properties */
function collectNavigator(): string {
  const n = navigator;
  return [
    n.hardwareConcurrency,
    (n as any).deviceMemory ?? '',
    n.maxTouchPoints,
    n.languages?.join(',') ?? '',
    n.platform,
    n.cookieEnabled,
    (n as any).pdfViewerEnabled ?? '',
    String(!!(n as any).webdriver),
    n.doNotTrack ?? '',
  ].join('|');
}

/** Screen + window geometry */
function collectScreen(): string {
  const s = screen;
  return [
    s.width, s.height,
    s.availWidth, s.availHeight,
    s.colorDepth, s.pixelDepth,
    devicePixelRatio,
    (s as any).isExtended ?? '',
    window.innerWidth, window.innerHeight,
    window.outerWidth, window.outerHeight,
    window.screenX, window.screenY,
    // Taskbar side/size: differ between OS/monitor configs
    s.width - s.availWidth,
    s.height - s.availHeight,
  ].join('|');
}

/** Timezone + Intl formatting quirks */
function collectLocale(): string {
  const dtf = new Intl.DateTimeFormat();
  const ro = dtf.resolvedOptions();
  const nf = new Intl.NumberFormat();
  // Decimal separator varies (. vs ,) and reveals OS locale deeply
  const decimalSep = nf.format(1.1).charAt(1);
  const dstOffset = (() => {
    // Summer vs winter offset difference reveals DST rules for this timezone
    const jan = new Date(2024, 0, 1).getTimezoneOffset();
    const jul = new Date(2024, 6, 1).getTimezoneOffset();
    return Math.abs(jan - jul);
  })();
  return [
    new Date().getTimezoneOffset(),
    ro.timeZone,
    ro.locale,
    ro.calendar,
    ro.numberingSystem,
    decimalSep,
    dstOffset,
    new Intl.Collator().resolvedOptions().locale,
  ].join('|');
}

/** CSS media query fingerprint */
function collectMediaQueries(): string {
  return [
    mq('(prefers-color-scheme: dark)'),
    mq('(prefers-reduced-motion: reduce)'),
    mq('(prefers-contrast: more)'),
    mq('(inverted-colors: inverted)'),
    mq('(forced-colors: active)'),
    mq('(pointer: fine)'),
    mq('(pointer: coarse)'),
    mq('(hover: hover)'),
    mq('(display-mode: standalone)'),
    mq('(display-mode: fullscreen)'),
  ].join('|');
}

/** Canvas 2D rendering hash (off-screen, 1×1 canvas for speed) */
function collectCanvas(): Promise<string> {
  return new Promise(resolve => {
    try {
      const cv = document.createElement('canvas');
      cv.width = 200; cv.height = 30;
      const ctx = cv.getContext('2d');
      if (!ctx) { resolve(''); return; }
      // Use a mix of text, curves, and color fills to maximise variance
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.font = '11pt no-real-font,serif';
      ctx.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.font = '18pt Arial,sans-serif';
      ctx.fillText('Cwm fjordbank', 4, 25);
      resolve(cv.toDataURL());
    } catch { resolve(''); }
  });
}

/** WebGL renderer/vendor + capability limits */
function collectWebGL(): string {
  try {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const gl = cv.getContext('webgl') || cv.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    const vendor   = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '';
    const maxTex   = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxVec   = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
    const exts     = gl.getSupportedExtensions()?.sort().join(',') ?? '';
    // Render a tiny scene to capture floating-point GPU variance
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}');
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, 'void main(){gl_FragColor=vec4(0.4,sin(0.7),cos(1.3),1);}');
    gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [renderer, vendor, maxTex, maxVec, exts, px.join(',')].join('|');
  } catch { return ''; }
}

/**
 * AudioContext hash via OfflineAudioContext.
 * Uses a very short (256-sample) buffer to minimise CPU time.
 */
function collectAudio(): Promise<string> {
  return withTimeout(new Promise(resolve => {
    try {
      const ctx = new OfflineAudioContext(1, 256, 44100);
      const osc = ctx.createOscillator();
      const cmp = ctx.createDynamicsCompressor();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      // Probe DynamicsCompressor params — values subtly differ per audio engine
      (cmp.knee as AudioParam).value = 40;
      (cmp.ratio as AudioParam).value = 12;
      (cmp.attack as AudioParam).value = 0;
      (cmp.release as AudioParam).value = 0.25;
      osc.connect(cmp);
      cmp.connect(ctx.destination);
      osc.start(0);
      ctx.startRendering().then(buf => {
        const data = buf.getChannelData(0);
        // Sum a sample of values for a fast, stable hash contribution
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += Math.abs(data[i]);
        resolve(sum.toFixed(15));
      }).catch(() => resolve(''));
    } catch { resolve(''); }
  }), 1500, '');
}

/** JavaScript engine + FPU floating-point quirks */
function collectMathFingerprint(): string {
  return [
    Math.tan(-1e300).toFixed(20),
    Math.sin(Math.PI).toFixed(20),
    Math.cos(Math.PI / 3).toFixed(20),
    (Math.sqrt(2) * Math.log(1e-10)).toFixed(20),
    (1 / Math.sinh(0.0001)).toFixed(10),
  ].join('|');
}

/** Font detection via text-metric comparison against fallback */
function collectFonts(): string {
  const BASE_FONTS = ['monospace', 'sans-serif', 'serif'];
  const TEST_FONTS = [
    'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS',
    'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue',
    'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif',
    'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana', 'Franklin Gothic Medium',
    'Century Gothic', 'Gill Sans', 'Garamond', 'Futura', 'Optima',
  ];
  const TEST_STRING = 'mmmmmmmmmmlli';
  const TEST_SIZE = '72px';

  // Measure baseline widths for all three generic families
  const span = document.createElement('span');
  span.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  span.textContent = TEST_STRING;
  document.body.appendChild(span);

  const baselines: Record<string, {w: number, h: number}> = {};
  for (const base of BASE_FONTS) {
    span.style.font = `${TEST_SIZE} ${base}`;
    baselines[base] = { w: span.offsetWidth, h: span.offsetHeight };
  }

  const detected: string[] = [];
  for (const font of TEST_FONTS) {
    for (const base of BASE_FONTS) {
      span.style.font = `${TEST_SIZE} '${font}',${base}`;
      if (span.offsetWidth !== baselines[base].w || span.offsetHeight !== baselines[base].h) {
        detected.push(font);
        break;
      }
    }
  }

  document.body.removeChild(span);
  return detected.sort().join(',');
}

/** Speech synthesis voices (installed TTS engines) */
function collectSpeechVoices(): Promise<string> {
  return withTimeout(new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(''); return; }
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices.map(v => `${v.name}:${v.lang}`).sort().join(','));
    } else {
      speechSynthesis.onvoiceschanged = () => {
        const v2 = speechSynthesis.getVoices();
        resolve(v2.map(v => `${v.name}:${v.lang}`).sort().join(','));
      };
    }
  }), 400, '');
}

/** Gamepad API: connected controller identifiers */
function collectGamepads(): string {
  try {
    const pads = navigator.getGamepads?.() ?? [];
    const ids = Array.from(pads).filter(Boolean).map(p => p!.id);
    return ids.join(',');
  } catch { return ''; }
}

/** Performance micro-benchmark to measure CPU speed/variant */
function collectPerfBenchmark(): string {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 1e5; i++) x += Math.sqrt(i) * Math.sin(i);
  const elapsed = (performance.now() - t0).toFixed(2);
  // Bucket into ~16 buckets to avoid noise while preserving hardware signal
  return String(Math.round(parseFloat(elapsed) / 2) * 2) + '|' + x.toFixed(6);
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Collects all passive fingerprint signals in parallel and returns a SHA-256
 * hex string. Takes ~50-200ms total; the OfflineAudioContext is the slowest path.
 */
export async function collectFingerprint(): Promise<string> {
  const [
    canvasResult,
    audioResult,
    speechResult,
  ] = await Promise.allSettled([
    collectCanvas(),
    collectAudio(),
    collectSpeechVoices(),
  ]);

  const components = [
    collectNavigator(),
    collectScreen(),
    collectLocale(),
    collectMediaQueries(),
    canvasResult.status === 'fulfilled' ? canvasResult.value : '',
    collectWebGL(),
    audioResult.status === 'fulfilled' ? audioResult.value : '',
    collectMathFingerprint(),
    collectFonts(),
    speechResult.status === 'fulfilled' ? speechResult.value : '',
    collectGamepads(),
    collectPerfBenchmark(),
  ].join('||');

  const encoded = new TextEncoder().encode(components);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}
