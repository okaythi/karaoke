/**
 * Passive browser fingerprint behind the anonymous listener ID.
 *
 * Only signals that stay the same from visit to visit are read: a signal that
 * moves with the window, the zoom level or the time of day would give the
 * same browser a new ID each time. Nothing here asks for a permission. The
 * result is a SHA-256 hex string, which the server mixes with what it sees
 * of the connection.
 */

type ExtendedNavigator = Navigator & { deviceMemory?: number; pdfViewerEnabled?: boolean };

const matches = (query: string): string => String(window.matchMedia(query).matches);

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);
}

function collectNavigator(): string {
  const n: ExtendedNavigator = navigator;
  return [
    n.hardwareConcurrency,
    n.deviceMemory ?? '',
    n.maxTouchPoints,
    n.languages?.join(',') ?? '',
    n.platform,
    n.cookieEnabled,
    n.pdfViewerEnabled ?? '',
    String(!!n.webdriver),
    n.doNotTrack ?? ''
  ].join('|');
}

/** The display itself, not the window on it. */
function collectScreen(): string {
  return [screen.width, screen.height, screen.colorDepth, screen.pixelDepth].join('|');
}

function collectLocale(): string {
  const dateOptions = new Intl.DateTimeFormat().resolvedOptions();
  // The decimal separator (. or ,) reflects the OS locale rather than the browser language.
  const decimalSeparator = new Intl.NumberFormat().format(1.1).charAt(1);
  // The gap between winter and summer offsets identifies the zone's daylight-saving rule.
  const daylightShift = Math.abs(new Date(2024, 0, 1).getTimezoneOffset() - new Date(2024, 6, 1).getTimezoneOffset());
  return [
    dateOptions.timeZone,
    dateOptions.locale,
    dateOptions.calendar,
    dateOptions.numberingSystem,
    decimalSeparator,
    daylightShift,
    new Intl.Collator().resolvedOptions().locale
  ].join('|');
}

/** Input hardware and accessibility settings; colour scheme and display mode change too often to use. */
function collectMediaQueries(): string {
  return [
    matches('(prefers-reduced-motion: reduce)'),
    matches('(prefers-contrast: more)'),
    matches('(inverted-colors: inverted)'),
    matches('(forced-colors: active)'),
    matches('(pointer: fine)'),
    matches('(pointer: coarse)'),
    matches('(hover: hover)')
  ].join('|');
}

/** How this machine rasterizes text and shapes. */
function collectCanvas(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 30;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#f60';
    context.fillRect(125, 1, 62, 20);
    context.fillStyle = '#069';
    context.font = '11pt no-real-font,serif';
    context.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
    context.fillStyle = 'rgba(102,204,0,0.7)';
    context.font = '18pt Arial,sans-serif';
    context.fillText('Cwm fjordbank', 4, 25);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

/** GPU model, limits and extensions, plus one rendered pixel for floating-point differences between GPUs. */
function collectWebGL(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl');
    if (!gl) return '';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : '';
    const extensions = gl.getSupportedExtensions()?.sort().join(',') ?? '';

    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, 'void main(){gl_FragColor=vec4(0.4,sin(0.7),cos(1.3),1);}'));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    return [renderer, vendor, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), extensions, pixel.join(',')].join('|');
  } catch {
    return '';
  }
}

/** A short offline render through a compressor, whose output differs slightly between audio engines. */
function collectAudio(): Promise<string> {
  return withTimeout(new Promise<string>(resolve => {
    try {
      const context = new OfflineAudioContext(1, 256, 44100);
      const oscillator = context.createOscillator();
      const compressor = context.createDynamicsCompressor();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      context.startRendering().then(buffer => {
        const samples = buffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 4) sum += Math.abs(samples[i]);
        resolve(sum.toFixed(15));
      }).catch(() => resolve(''));
    } catch {
      resolve('');
    }
  }), 1500, '');
}

/** Results that differ between JavaScript engines and floating-point units. */
function collectMath(): string {
  return [
    Math.tan(-1e300).toFixed(20),
    Math.sin(Math.PI).toFixed(20),
    Math.cos(Math.PI / 3).toFixed(20),
    (Math.sqrt(2) * Math.log(1e-10)).toFixed(20),
    (1 / Math.sinh(0.0001)).toFixed(10)
  ].join('|');
}

const GENERIC_FONTS = ['monospace', 'sans-serif', 'serif'];
const PROBED_FONTS = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS',
  'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue',
  'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif',
  'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Franklin Gothic Medium',
  'Century Gothic', 'Gill Sans', 'Garamond', 'Futura', 'Optima'
];

/**
 * Installed fonts: a font is present when text set in it measures differently
 * from the generic fallback. Measured on a canvas, which needs no page layout.
 */
function collectFonts(): string {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return '';
  const widthIn = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText('mmmmmmmmmmlli').width;
  };
  const fallbackWidths = GENERIC_FONTS.map(widthIn);
  return PROBED_FONTS
    .filter(font => GENERIC_FONTS.some((generic, index) => widthIn(`'${font}',${generic}`) !== fallbackWidths[index]))
    .sort()
    .join(',');
}

export async function collectFingerprint(): Promise<string> {
  const components = [
    collectNavigator(),
    collectScreen(),
    collectLocale(),
    collectMediaQueries(),
    collectCanvas(),
    collectWebGL(),
    await collectAudio(),
    collectMath(),
    collectFonts()
  ].join('||');

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(components));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
