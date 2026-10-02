/**
 * Draws an engraved system as SVG, in staff-space units: one SVG user unit is
 * one staff space, so the page decides the size by CSS alone. Every item is
 * tagged with its catalogue element and semantic labels, carries its resolved
 * colours as CSS variables, and noteheads get a glide overlay that playback
 * fills from left to right.
 */
import { MUSIC_EM, MUSIC_FONT, fontFamily, glyph } from '../fonts/glyphs';
import type { DisplayItem } from '../layout/display';
import type { EngravedSystem } from '../layout/system';
import type { Gradient, StyleResolver } from '../style/style';

const SVG_NS = 'http://www.w3.org/2000/svg';
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Elements whose items are noteheads that glide while they sound. */
const GLIDING = /^(note\.head|grace\.|cue\.note)/;

export interface RenderOptions {
  /** Space around the ink, in staff spaces. */
  readonly margin?: number;
  /** Fixed vertical extent, so the lines of one piece share a scale. */
  readonly frame?: { readonly top: number; readonly bottom: number };
  readonly title?: string;
  readonly style?: StyleResolver;
  /** Add glide overlays to noteheads. */
  readonly glides?: boolean;
}

/** A notehead's glide: an overlay clipped by a rectangle that playback widens. */
export interface GlideTarget {
  readonly noteId: string;
  readonly clip: SVGRectElement;
  readonly base: SVGElement;
  readonly overlay: SVGElement;
  /** Full width of the notehead, in staff spaces. */
  readonly width: number;
}

export interface RenderedSystem {
  readonly svg: SVGSVGElement;
  readonly glides: readonly GlideTarget[];
  /** Every node drawn for a score ID. */
  readonly nodes: ReadonlyMap<string, readonly SVGElement[]>;
}

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, typeof value === 'number' ? String(round(value)) : value);
  return node;
}

/** Class names for an item: its catalogue element and family, for styling. */
export function itemClasses(item: DisplayItem): string {
  const [family] = item.element.split('.');
  return `n-${item.element.replace(/\./g, '-')} nf-${family}`;
}

export function renderItem(item: DisplayItem): SVGElement {
  const p = item.primitive;
  let node: SVGElement;
  switch (p.kind) {
    case 'glyph': {
      node = element('text', { 'font-family': MUSIC_FONT, 'font-size': MUSIC_EM * p.scale });
      node.textContent = glyph(p.glyph).char;
      if (p.rotate || p.scaleX || p.scaleY) {
        const scale = p.scaleX || p.scaleY ? ` scale(${round(p.scaleX ?? 1)} ${round(p.scaleY ?? 1)})` : '';
        node.setAttribute('transform', `translate(${round(p.x)} ${round(p.y)})${p.rotate ? ` rotate(${p.rotate})` : ''}${scale}`);
      } else {
        node.setAttribute('x', String(round(p.x)));
        node.setAttribute('y', String(round(p.y)));
      }
      break;
    }
    case 'line':
      node = element('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, 'stroke-width': p.thickness, 'stroke-linecap': p.cap ?? 'butt' });
      if (p.dash) node.setAttribute('stroke-dasharray', p.dash.join(' '));
      break;
    case 'polygon':
      node = element('polygon', { points: p.points.map(round).join(' ') });
      break;
    case 'path':
      node = element('path', { d: p.d });
      if (!p.fill) { node.setAttribute('fill', 'none'); node.setAttribute('stroke-width', String(p.thickness ?? 0.16)); }
      break;
    case 'text':
      node = element('text', {
        x: p.x, y: p.y, 'font-family': fontFamily(p.face), 'font-size': p.size,
        'text-anchor': p.anchor, ...(p.italic ? { 'font-style': 'italic' } : {})
      });
      node.textContent = p.text;
      break;
    case 'rect':
      node = element('rect', { x: p.x, y: p.y, width: p.width, height: p.height, fill: 'none', 'stroke-width': p.thickness });
      break;
  }
  node.setAttribute('class', `${itemClasses(item)} n-${p.kind}`);
  const { staff, voice } = item.semantic;
  if (staff) node.setAttribute('data-staff', staff);
  if (voice) node.setAttribute('data-voice', String(voice));
  if (item.refs.length) node.setAttribute('data-ref', item.refs.join(' '));
  return node;
}

let gradientCounter = 0;

export function renderSystemView(system: EngravedSystem, options: RenderOptions = {}): RenderedSystem {
  const margin = options.margin ?? 1.5;
  const top = (options.frame?.top ?? system.box.y0) - margin;
  const bottom = (options.frame?.bottom ?? system.box.y1) + margin;
  const left = Math.min(system.box.x0, 0) - margin;
  const right = Math.max(system.box.x1, system.width) + margin;
  const svg = element('svg', { viewBox: `${round(left)} ${round(top)} ${round(right - left)} ${round(bottom - top)}`, class: 'notation-system' });
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.title ?? `Music, measures ${system.first + 1}–${system.last + 1}`);
  const defs = element('defs', {});
  svg.appendChild(defs);
  const group = element('g', { class: 'notation-ink' });
  svg.appendChild(group);
  const glides: GlideTarget[] = [];
  const nodes = new Map<string, SVGElement[]>();
  const gradients = new Map<string, string>();

  const gradientFill = (gradient: Gradient): string => {
    const key = `${gradient.from}|${gradient.to}`;
    let id = gradients.get(key);
    if (!id) {
      id = `glide-gradient-${++gradientCounter}`;
      gradients.set(key, id);
      const linear = element('linearGradient', { id, x1: '0', x2: '1', y1: '0', y2: '0' });
      linear.appendChild(element('stop', { offset: '0', 'stop-color': gradient.from }));
      linear.appendChild(element('stop', { offset: '1', 'stop-color': gradient.to }));
      defs.appendChild(linear);
    }
    return `url(#${id})`;
  };

  for (const item of system.items) {
    const node = renderItem(item);
    const style = options.style?.resolve(item);
    if (style) {
      node.style.setProperty('--ink', style.ink);
      if (style.played !== style.ink) node.style.setProperty('--played', style.played);
      if (style.upcoming !== style.ink) node.style.setProperty('--upcoming', style.upcoming);
      if (style.opacity !== 1) node.setAttribute('opacity', String(style.opacity));
    }
    group.appendChild(node);
    for (const ref of item.refs) (nodes.get(ref) ?? nodes.set(ref, []).get(ref)!).push(node);

    if (options.glides && GLIDING.test(item.element) && item.refs.length) {
      const id = `glide-clip-${++gradientCounter}`;
      const clip = element('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
      const rect = element('rect', { x: item.box.x0 - 0.05, y: item.box.y0 - 0.1, width: 0, height: item.box.y1 - item.box.y0 + 0.2 });
      clip.appendChild(rect);
      defs.appendChild(clip);
      const overlay = node.cloneNode(true) as SVGElement;
      overlay.removeAttribute('data-ref');
      overlay.setAttribute('class', `${node.getAttribute('class')} n-glide`);
      overlay.setAttribute('clip-path', `url(#${id})`);
      const glide = style?.glide ?? 'var(--accent-brass)';
      overlay.style.setProperty('--glide', typeof glide === 'string' ? glide : gradientFill(glide));
      group.appendChild(overlay);
      glides.push({ noteId: item.refs[0], clip: rect, base: node, overlay, width: item.box.x1 - item.box.x0 + 0.1 });
    }
  }
  return { svg, glides, nodes };
}

export function renderSystem(system: EngravedSystem, options: RenderOptions = {}): SVGSVGElement {
  return renderSystemView(system, options).svg;
}
