import { escapeHtml, lyricHtml } from '../core/html';
import { hasCjk } from '../core/script';
import { collectParts, isTimed } from '../core/parts';
import { followPlayback } from '../playback/frames';
import { wordProgress, type RenderEngineController, type RenderEngineOptions } from './renderEngine';
import { buildEnsembleSections, ensembleLayout, ensembleVoiceOrder, letterboxBarSlot, visibleSection, visiblePhrases, reservedLaneHeight, type EnsembleSection, type EnsembleLane } from './ensembleModel';

type PhraseLine = { element: HTMLElement; words: HTMLElement[]; written: number[] };
type VoiceLane = {
  element: HTMLElement;
  plan: EnsembleLane;
  target: number;
  phrase: PhraseLine | null;
  colorKey: string;
  typography: string;
  heights: Map<number, number>;
};

/** One video clock and one stable area per singer, with no visible speaker labels. */
export function createEnsembleEngine(options: RenderEngineOptions): RenderEngineController {
  const { videoElement: video, containerElement: container, letterboxBars = false } = options;
  const verses = options.lyricsData ?? [];
  const parts = collectParts(verses, options.parts ?? []);
  let sections = buildEnsembleSections(verses);
  let voiceOrder = ensembleVoiceOrder(verses);
  const stage = document.createElement('div');
  stage.className = `ensemble-stage${letterboxBars ? ' ensemble-letterbox' : ''}`;
  const grid = document.createElement('div');
  grid.className = 'ensemble-grid';
  const shared = document.createElement('div');
  shared.className = 'ensemble-shared';
  stage.appendChild(grid);
  stage.appendChild(shared);
  container.appendChild(stage);
  if (!letterboxBars) container.classList.add('ensemble-lyrics');
  const previousHidden = [options.topLineElement.hidden, options.bottomLineElement.hidden];
  options.topLineElement.hidden = options.bottomLineElement.hidden = true;
  let current: EnsembleSection | undefined;
  const lanes = new Map<string, VoiceLane>();
  let voiceLanes: VoiceLane[] = [];
  let lastTime = NaN;

  const onStageClick = (event: MouseEvent) => {
    const wordEl = (event.target as Element | null)?.closest<HTMLElement>('.word-wrapper[data-start]');
    if (!wordEl) return;
    event.stopPropagation();
    const start = Number(wordEl.dataset.start);
    if (Number.isFinite(start) && start >= 0) {
      video.currentTime = Math.max(0, start + (options.globalOffset ?? 0));
    }
  };
  stage.addEventListener('click', onStageClick);

  const fit = () => {
    if (letterboxBars) {
      grid.style.setProperty('--ensemble-columns', '1');
      voiceLanes.forEach((lane, index) => {
        lane.element.style.gridColumn = '1 / span 1';
        lane.element.style.gridRow = 'auto';
        lane.element.dataset.bar = letterboxBarSlot(lane.plan.key, voiceOrder, index);
        lane.element.classList.remove('ensemble-lead');
      });
      return;
    }
    const { columns, places } = ensembleLayout(voiceLanes.length, container.clientWidth);
    grid.style.setProperty('--ensemble-columns', String(columns));
    voiceLanes.forEach((lane, index) => {
      const place = places[index];
      lane.element.style.gridColumn = `${place.column} / span ${place.span}`;
      lane.element.style.gridRow = String(place.row);
      delete lane.element.dataset.bar;
      lane.element.classList.toggle('ensemble-lead', voiceLanes.length > 2 && index === 0);
    });
    reserveLaneHeights();
  };
  const mountSection = (section: EnsembleSection | undefined) => {
    current = section;
    const keep = new Set<string>();
    voiceLanes = [];
    const mountLane = (plan: EnsembleLane, parent: HTMLElement) => {
      const key = plan.key;
      keep.add(key);
      let lane = lanes.get(key);
      if (!lane) {
        const element = document.createElement('div');
        element.className = 'ensemble-voice';
        lane = { element, plan, target: -1, phrase: null, colorKey: '', typography: '', heights: new Map() };
        lanes.set(key, lane);
      }
      lane.plan = plan;
      lane.element.dataset.parts = JSON.stringify(plan.partIds);
      lane.element.setAttribute('aria-label', plan.partIds.map(id => parts.find(part => part.id === id)?.name ?? id).join(' + ') || 'Unassigned');
      // Moving the container preserves its phrase nodes and wipe caches.
      parent.appendChild(lane.element);
      return lane;
    };
    section?.voices.forEach(plan => voiceLanes.push(mountLane(plan, grid)));
    section?.shared.forEach(plan => mountLane(plan, shared));
    for (const [key, lane] of lanes) {
      if (!keep.has(key)) { lane.element.remove(); lanes.delete(key); }
    }
    grid.hidden = voiceLanes.length === 0;
    shared.hidden = !section?.shared.length;
    fit();
  };
  const createPhrase = (target: number): PhraseLine => {
    const verse = verses[target];
    const element = document.createElement('div');
    element.className = `ensemble-line${verse.words.some(word => !!word.furigana) ? ' k-line-has-ruby' : ''}`;
    element.innerHTML = verse.words.map(word => {
      const text = lyricHtml(word.word);
      const display = word.furigana
        ? `<span class="yomitan-ruby" data-furi="${escapeHtml(word.furigana)}"><span class="ruby-base">${text}</span></span>`
        : text;
      const classes = `word-wrapper${word.furigana ? ' word-has-ruby' : ''}${hasCjk(word.word) ? ' word-cjk' : ''}`;
      const startAttr = isTimed(word) ? ` data-start="${word.start}"` : '';
      return `<span class="${classes}"${startAttr}><span class="word-base">${display}</span><span class="word-highlight" aria-hidden="true">${display}</span></span>`;
    }).join('') + (verse.translation ? `<span class="k-line-translation">${lyricHtml(verse.translation)}</span>` : '');
    return { element, words: Array.from(element.querySelectorAll<HTMLElement>('.word-wrapper')), written: [] };
  };
  // Measure only when a passage mounts or its width changes. Reserving wrapped
  // text prevents lower singers jumping when one phrase replaces another. The probe never becomes visible or accessible.
  const probe = document.createElement('div');
  probe.className = 'ensemble-voice ensemble-measure';
  probe.setAttribute('aria-hidden', 'true');
  const reserveLaneHeights = () => {
    for (const lane of lanes.values()) {
      const width = lane.element.getBoundingClientRect().width;
      if (!width) continue;
      const typography = `${width}:${getComputedStyle(lane.element).fontSize}`;
      if (typography !== lane.typography) { lane.typography = typography; lane.heights.clear(); }
      // Timing taps reuse text metrics; only newly timed text needs a probe.
      const missing = lane.plan.verses.filter(target => !lane.heights.has(target));
      if (missing.length) {
        probe.style.width = `${width}px`;
        lane.element.parentElement!.appendChild(probe);
        for (const target of missing) {
          const primary = createPhrase(target).element;
          probe.replaceChildren(primary);
          lane.heights.set(target, primary.getBoundingClientRect().height);
        }
        probe.remove();
      }
      lane.element.style.minHeight = `${reservedLaneHeight(lane.plan, lane.heights)}px`;
    }
  };
  const draw = () => {
    const time = video.currentTime - (options.globalOffset ?? 0);
    if (time === lastTime) return;
    lastTime = time;
    const section = visibleSection(sections, time);
    if (section !== current) mountSection(section);
    if (letterboxBars) stage.style.opacity = section ? '1' : '0';
    else container.style.opacity = section ? '1' : '0';
    const shown = section ? visiblePhrases(section, verses, time) : undefined;
    for (const [key, lane] of lanes) {
      const displayed = shown?.get(key);
      const target = displayed?.index ?? -1;
      if (target !== lane.target) {
        lane.target = target;
        lane.phrase = target >= 0 ? createPhrase(target) : null;
        lane.element.replaceChildren(...(lane.phrase ? [lane.phrase.element] : []));
        lane.colorKey = '';
      }
      const line = lane.phrase;
      if (!line || !displayed) continue;
      const colorKey = JSON.stringify(displayed.partIds);
      if (colorKey !== lane.colorKey) {
        lane.colorKey = colorKey;
        const colors = displayed.partIds.map((id) => parts.find(part => part.id === id)?.color ?? '#deb668');
        line.element.style.setProperty('--lyric-highlight', colors[0] ?? '#deb668');
        line.element.style.setProperty('--shared-colors', colors.length > 1 ? `linear-gradient(to right, ${colors.map((color, c) => `${color} ${c / colors.length * 100}% ${(c + 1) / colors.length * 100}%`).join(', ')})` : 'none');
        line.element.classList.toggle('shared-part', colors.length > 1);
        lane.element.dataset.parts = colorKey;
        lane.element.setAttribute('aria-label', displayed.partIds.map((id) => parts.find(part => part.id === id)?.name ?? id).join(' + ') || 'Unassigned');
      }
      verses[target].words.forEach((word, w) => {
        const progress = isTimed(word) ? wordProgress(word.start, word.end, time) : 0;
        if (line.written[w] === progress) return;
        line.written[w] = progress;
        line.words[w]?.style.setProperty('--wipe-progress', `${progress}%`);
      });
    }
  };
  const fontsLoaded = () => { for (const lane of lanes.values()) lane.heights.clear(); fit(); };
  document.fonts?.addEventListener('loadingdone', fontsLoaded);
  const frames = followPlayback(video, draw);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined;
  resize?.observe(container);
  draw();
  return {
    refreshTimings() { sections = buildEnsembleSections(verses); voiceOrder = ensembleVoiceOrder(verses); lastTime = NaN; draw(); },
    setLineMode() { /* Each singer displays one current phrase in a stable area. */ },
    destroy() {
      frames.stop(); resize?.disconnect(); stage.remove(); probe.remove();
      document.fonts?.removeEventListener('loadingdone', fontsLoaded);
      if (!letterboxBars) {
        container.classList.remove('ensemble-lyrics');
        container.style.opacity = '';
      }
      options.topLineElement.hidden = previousHidden[0];
      options.bottomLineElement.hidden = previousHidden[1];
    }
  };
}
