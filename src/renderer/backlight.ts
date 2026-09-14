/**
 * Ambient Dynamic Backlight
 * Samples video frame via offscreen canvas at 30 FPS (throttled)
 * and projects smooth blurred glow behind the media viewport.
 */
export function initDynamicBacklight(
  vidEl: HTMLVideoElement,
  container: HTMLElement
): { destroy: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  container.innerHTML = `
    <div class="bl-layer bl-1" style="position: absolute; top: -20px; left: -20px; right: -20px; bottom: -20px; filter: blur(35px); opacity: 0.8; transition: background 0.35s ease; border-radius: 16px;"></div>
    <div class="bl-layer bl-2" style="position: absolute; top: -40px; left: -40px; right: -40px; bottom: -40px; filter: blur(60px); opacity: 0.55; transition: background 0.35s ease; border-radius: 24px;"></div>
  `;

  const bl1 = container.querySelector('.bl-1') as HTMLElement;
  const bl2 = container.querySelector('.bl-2') as HTMLElement;

  let backlightFrame: number | null = null;
  let tickCount = 0;
  let isDestroyed = false;

  const updateBacklight = () => {
    if (isDestroyed) return;

    if (vidEl.paused || vidEl.ended || !ctx) {
      backlightFrame = requestAnimationFrame(updateBacklight);
      return;
    }

    tickCount++;
    if (tickCount % 2 !== 0) {
      backlightFrame = requestAnimationFrame(updateBacklight);
      return;
    }

    try {
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

      if (bl1 && bl2) {
        bl1.style.background = `rgba(${r}, ${g}, ${b}, 0.55)`;
        bl2.style.background = `rgba(${r}, ${g}, ${b}, 0.35)`;
      }
    } catch (_) {
      // Ignore cross-origin canvas read exceptions if any
    }

    backlightFrame = requestAnimationFrame(updateBacklight);
  };

  backlightFrame = requestAnimationFrame(updateBacklight);

  const onPause = () => {
    if (backlightFrame) cancelAnimationFrame(backlightFrame);
  };
  const onPlay = () => {
    if (!isDestroyed) backlightFrame = requestAnimationFrame(updateBacklight);
  };

  vidEl.addEventListener('pause', onPause);
  vidEl.addEventListener('play', onPlay);

  return {
    destroy: () => {
      isDestroyed = true;
      if (backlightFrame) cancelAnimationFrame(backlightFrame);
      vidEl.removeEventListener('pause', onPause);
      vidEl.removeEventListener('play', onPlay);
      container.innerHTML = '';
    }
  };
}
