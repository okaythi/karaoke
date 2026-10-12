import { escapeHtml, lyricHtml } from '../core/html';
import { hasCjk } from '../core/script';
import { collectParts, isTimed, partIds, partColor } from '../core/parts';
import { followPlayback } from '../playback/frames';
import { wordProgress, type RenderEngineController, type RenderEngineOptions } from './renderEngine';
import { buildEnsembleSections, visibleSection, slotVerse, type EnsembleSection } from './ensembleModel';

/** One video clock, independent word wipes, and no visible speaker labels. */
export function createEnsembleEngine(options: RenderEngineOptions): RenderEngineController {
  const { videoElement: video, containerElement: container } = options;
  const verses = options.lyricsData ?? [];
  const parts = collectParts(verses, options.parts ?? []);
  let sections = buildEnsembleSections(verses);
  const grid = document.createElement('div');
  grid.className = 'ensemble-grid';
  container.appendChild(grid);
  container.classList.add('ensemble-lyrics');
  options.topLineElement.hidden = options.bottomLineElement.hidden = true;
  let current: EnsembleSection | undefined;
  let lines: { element: HTMLElement; target: number; words: HTMLElement[]; written: number[] }[] = [];

  const fit = () => {
    const width = container.clientWidth;
    const columns = width >= 1400 ? 4 : width >= 980 ? 3 : width >= 560 ? 2 : 1;
    grid.style.setProperty('--ensemble-columns', String(Math.min(columns, Math.max(1, lines.length))));
  };
  const mountSection = (section: EnsembleSection | undefined) => {
    current = section;
    const count = section?.slots.length ?? 0;
    const previousCount = lines.length;
    // Retain lyric nodes and wipe caches when edited timings keep the same lane count.
    while (lines.length > count) lines.pop()!.element.remove();
    while (lines.length < count) {
      const element = document.createElement('div');
      element.className = 'ensemble-line';
      grid.appendChild(element);
      lines.push({ element, target: -2, words: [], written: [] });
    }
    if (count !== previousCount) fit();
  };
  const draw = () => {
    const time = video.currentTime - (options.globalOffset ?? 0);
    const section = visibleSection(sections, time);
    if (section !== current) mountSection(section);
    container.style.opacity = section ? '1' : '0';
    section?.slots.forEach((slot, index) => {
      const line = lines[index];
      const target = slotVerse(slot, verses, time);
      if (line.target !== target) {
        line.target = target;
        const verse = verses[target];
        line.element.innerHTML = verse ? verse.words.map(word => {
          const text = lyricHtml(word.word);
          const display = word.furigana ? `<span class="yomitan-ruby" data-furi="${escapeHtml(word.furigana)}">${text}</span>` : text;
          return `<span class="word-wrapper${hasCjk(word.word) ? ' word-cjk' : ''}"><span class="word-base">${display}</span><span class="word-highlight" aria-hidden="true">${display}</span></span>`;
        }).join('') + (verse.translation ? `<span class="k-line-translation">${lyricHtml(verse.translation)}</span>` : '') : '';
        line.element.style.setProperty('--lyric-highlight', verse ? partColor(verse, parts) : '#deb668');
        const colors = verse ? partIds(verse).map(id => parts.find(part => part.id === id)?.color ?? '#deb668') : [];
        line.element.style.setProperty('--shared-colors', colors.length > 1 ? `linear-gradient(to right, ${colors.map((color, c) => `${color} ${c / colors.length * 100}% ${(c + 1) / colors.length * 100}%`).join(', ')})` : 'none');
        line.element.classList.toggle('shared-part', colors.length > 1);
        line.words = Array.from(line.element.querySelectorAll<HTMLElement>('.word-wrapper'));
        line.written = [];
      }
      const verse = verses[target];
      if (!verse) return;
      verse.words.forEach((word, w) => {
        const progress = isTimed(word) ? wordProgress(word.start, word.end, time) : 0;
        if (line.written[w] === progress) return;
        line.written[w] = progress;
        line.words[w]?.style.setProperty('--wipe-progress', `${progress}%`);
      });
    });
  };
  const frames = followPlayback(video, draw);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined;
  resize?.observe(container);
  draw();
  return {
    refreshTimings() { sections = buildEnsembleSections(verses); draw(); },
    setLineMode() { /* Ensemble vocals always retain every simultaneous phrase. */ },
    destroy() {
      frames.stop(); resize?.disconnect(); grid.remove();
      container.classList.remove('ensemble-lyrics');
      options.topLineElement.hidden = options.bottomLineElement.hidden = false;
    }
  };
}
