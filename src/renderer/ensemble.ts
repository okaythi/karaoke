import { escapeHtml, lyricHtml } from '../core/html';
import { hasCjk } from '../core/script';
import { collectParts, isTimed, partIds, partColor } from '../core/parts';
import { followPlayback } from '../playback/frames';
import { wordProgress, type RenderEngineController, type RenderEngineOptions } from './renderEngine';
import { buildEnsembleSections, ensembleLayout, visibleSection, laneVerses, reservedLaneHeight, type EnsembleSection, type EnsembleLane } from './ensembleModel';

type PhraseLine = { element: HTMLElement; words: HTMLElement[]; written: number[] };
type TextHeight = { primary: number; tail: number };
type VoiceLane = {
  element: HTMLElement;
  plan: EnsembleLane;
  targets: number[];
  phrases: Map<number, PhraseLine>;
  typography: string;
  heights: Map<number, TextHeight>;
};

/** One video clock and one stable area per singer, with no visible speaker labels. */
export function createEnsembleEngine(options: RenderEngineOptions): RenderEngineController {
  const { videoElement: video, containerElement: container } = options;
  const verses = options.lyricsData ?? [];
  const parts = collectParts(verses, options.parts ?? []);
  let sections = buildEnsembleSections(verses);
  const stage = document.createElement('div');
  stage.className = 'ensemble-stage';
  const grid = document.createElement('div');
  grid.className = 'ensemble-grid';
  const shared = document.createElement('div');
  shared.className = 'ensemble-shared';
  stage.append(grid, shared);
  container.appendChild(stage);
  container.classList.add('ensemble-lyrics');
  const previousHidden = [options.topLineElement.hidden, options.bottomLineElement.hidden];
  options.topLineElement.hidden = options.bottomLineElement.hidden = true;
  let current: EnsembleSection | undefined;
  const lanes = new Map<string, VoiceLane>();
  let voiceLanes: VoiceLane[] = [];
  let lastTime = NaN;

  const fit = () => {
    const { columns, places } = ensembleLayout(voiceLanes.length, container.clientWidth);
    grid.style.setProperty('--ensemble-columns', String(columns));
    voiceLanes.forEach((lane, index) => {
      const place = places[index];
      lane.element.style.gridColumn = `${place.column} / span ${place.span}`;
      lane.element.style.gridRow = String(place.row);
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
        lane = { element, plan, targets: [], phrases: new Map(), typography: '', heights: new Map() };
        lanes.set(key, lane);
      }
      lane.plan = plan;
      lane.element.style.setProperty('--ensemble-lane-lines', String(plan.maxLines));
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
    element.className = 'ensemble-line';
    element.innerHTML = verse.words.map(word => {
      const text = lyricHtml(word.word);
      const display = word.furigana ? `<span class="yomitan-ruby" data-furi="${escapeHtml(word.furigana)}">${text}</span>` : text;
      return `<span class="word-wrapper${hasCjk(word.word) ? ' word-cjk' : ''}"><span class="word-base">${display}</span><span class="word-highlight" aria-hidden="true">${display}</span></span>`;
    }).join('') + (verse.translation ? `<span class="k-line-translation">${lyricHtml(verse.translation)}</span>` : '');
    element.style.setProperty('--lyric-highlight', partColor(verse, parts));
    const colors = partIds(verse).map(id => parts.find(part => part.id === id)?.color ?? '#deb668');
    element.style.setProperty('--shared-colors', colors.length > 1 ? `linear-gradient(to right, ${colors.map((color, c) => `${color} ${c / colors.length * 100}% ${(c + 1) / colors.length * 100}%`).join(', ')})` : 'none');
    element.classList.toggle('shared-part', colors.length > 1);
    return { element, words: Array.from(element.querySelectorAll<HTMLElement>('.word-wrapper')), written: [] };
  };
  // Measure only when a passage mounts or its width changes. Reserving wrapped
  // text (not just phrase counts) prevents lower singers jumping when a long line
  // or held overlap disappears. The probe never becomes visible or accessible.
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
          const tail = primary.cloneNode(true) as HTMLElement;
          probe.replaceChildren(primary, tail);
          lane.heights.set(target, { primary: primary.getBoundingClientRect().height, tail: tail.getBoundingClientRect().height });
        }
        probe.remove();
      }
      lane.element.style.minHeight = `${reservedLaneHeight(lane.plan, verses, lane.heights)}px`;
    }
  };
  const draw = () => {
    const time = video.currentTime - (options.globalOffset ?? 0);
    if (time === lastTime) return;
    lastTime = time;
    const section = visibleSection(sections, time);
    if (section !== current) mountSection(section);
    container.style.opacity = section ? '1' : '0';
    for (const lane of lanes.values()) {
      const targets = laneVerses(lane.plan, verses, time);
      if (targets.length !== lane.targets.length || targets.some((target, i) => target !== lane.targets[i])) {
        for (const [target, phrase] of lane.phrases) {
          if (!targets.includes(target)) { phrase.element.remove(); lane.phrases.delete(target); }
        }
        targets.forEach(target => {
          let phrase = lane.phrases.get(target);
          if (!phrase) { phrase = createPhrase(target); lane.phrases.set(target, phrase); }
          lane.element.appendChild(phrase.element);
        });
        lane.targets = targets;
      }
      for (const [target, line] of lane.phrases) {
        verses[target].words.forEach((word, w) => {
          const progress = isTimed(word) ? wordProgress(word.start, word.end, time) : 0;
          if (line.written[w] === progress) return;
          line.written[w] = progress;
          line.words[w]?.style.setProperty('--wipe-progress', `${progress}%`);
        });
      }
    }
  };
  const fontsLoaded = () => { for (const lane of lanes.values()) lane.heights.clear(); fit(); };
  document.fonts?.addEventListener('loadingdone', fontsLoaded);
  const frames = followPlayback(video, draw);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined;
  resize?.observe(container);
  draw();
  return {
    refreshTimings() { sections = buildEnsembleSections(verses); lastTime = NaN; draw(); },
    setLineMode() { /* Every voice keeps its own area, including held overlaps. */ },
    destroy() {
      frames.stop(); resize?.disconnect(); stage.remove(); probe.remove();
      document.fonts?.removeEventListener('loadingdone', fontsLoaded);
      container.classList.remove('ensemble-lyrics');
      container.style.opacity = '';
      options.topLineElement.hidden = previousHidden[0];
      options.bottomLineElement.hidden = previousHidden[1];
    }
  };
}
