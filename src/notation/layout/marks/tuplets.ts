/** Tuplet numbers and brackets. */
import { glyph } from '../../fonts/glyphs';
import type { ChordEvent, ScoreEvent, Tuplet } from '../../model/types';
import type { DisplayItem } from '../display';
import { union } from '../display';
import type { DrawnEvent } from '../context';
import { semanticOf } from '../notes';
import { ENGRAVING } from '../settings';
import type { ChordShape } from '../shapes';
import { label } from './scope';
import type { Placed, Side, MarkScope } from './scope';

export function queueTuplets(scope: MarkScope): void {
  const { context, prepared, builder, index, clearShift, settle, jobs, nextOrder } = scope;

  const placeTuplet = (tuplet: Tuplet, members: readonly ScoreEvent[]): Placed | undefined => {
    const drawnMembers = members.map(event => context.drawn.get(event.id)!).sort((a, b) => a.x - b.x);
    const first = drawnMembers[0], last = drawnMembers.at(-1)!;
    const chords = members.filter((event): event is ChordEvent => event.kind === 'chord');
    const stems = chords.map(event => (prepared.shapes.get(event.id) as ChordShape).stem).filter(Boolean);
    const ups = stems.filter(stem => stem === 'up').length;
    const side: Side = tuplet.side && tuplet.side !== 'auto' ? tuplet.side : stems.length && ups * 2 < stems.length ? 'below' : 'above';
    const staff = members[0].staff;
    // One beam covering exactly the tuplet's notes needs no bracket.
    const plan = chords.length ? prepared.beamOf.get(chords[0].id) : undefined;
    const exactBeam = !!plan && members.every(event => plan.events.includes(event as ChordEvent)) &&
      plan.events.every(event => members.includes(event));
    const bracket = tuplet.bracket === 'show' || (tuplet.bracket !== 'hide' && !exactBeam);
    const conventional = tuplet.normal === 2 ** Math.floor(Math.log2(tuplet.actual)) || ((tuplet.actual === 2 || tuplet.actual === 4) && tuplet.normal === 3);
    const mode = tuplet.number && tuplet.number !== 'auto' ? tuplet.number : conventional ? 'number' : 'ratio';
    if (mode === 'none' && !bracket) return undefined;
    const semantic = semanticOf(members[0]);
    const refs = [tuplet.id];
    const items: DisplayItem[] = [];
    const scale = 0.72;
    const stemSide = (drawn: DrawnEvent) => !!drawn.stem && ((drawn.stem.direction === 'up') === (side === 'above'));
    const x0 = stemSide(first) ? first.stem!.x - 0.3 : first.heads.x0 - 0.2;
    const x1 = stemSide(last) ? last.stem!.x + 0.3 : last.heads.x1 + 0.2;
    const centre = (x0 + x1) / 2;
    const digits = (value: number) => String(value).split('').map(digit => `tuplet${digit}`);
    const names = mode === 'ratio' ? [...digits(tuplet.actual), 'tupletColon', ...digits(tuplet.normal)] : mode === 'number' ? digits(tuplet.actual) : [];
    const width = names.reduce((sum, name) => sum + glyph(name).advance * scale, 0);
    const numberHeight = 1.5 * scale;
    const extreme = side === 'above'
      ? Math.min(...drawnMembers.map(item => Math.min(item.heads.y0, item.stem?.tipY ?? Infinity))) - 0.6
      : Math.max(...drawnMembers.map(item => Math.max(item.heads.y1, item.stem?.tipY ?? -Infinity))) + 0.6;
    const baseline = side === 'above' ? extreme : extreme + numberHeight;
    let at = centre - width / 2;
    for (const name of names) {
      items.push(builder.glyph(name, at, baseline, label('tuplet.number', refs, semantic), { scale }));
      at += glyph(name).advance * scale;
    }
    if (bracket) {
      const lineY = baseline - numberHeight / 2;
      const hook = side === 'above' ? 0.6 : -0.6;
      const gapLeft = names.length ? centre - width / 2 - 0.3 : centre, gapRight = names.length ? centre + width / 2 + 0.3 : centre;
      const thickness = ENGRAVING.tupletBracketThickness;
      for (const [ax, ay, bx, by] of [[x0, lineY + hook, x0, lineY], [x0, lineY, gapLeft, lineY], [gapRight, lineY, x1, lineY], [x1, lineY, x1, lineY + hook]])
        items.push(builder.line(ax, ay, bx, by, thickness, label('tuplet.bracket', refs, semantic)));
    }
    if (!items.length) return undefined;
    const box = items.map(item => item.box).reduce(union);
    return settle(items, staff, side, clearShift(box, staff, side), baseline);
  };

  const tupletMembers = new Map<string, ScoreEvent[]>();
  for (const eventId of context.drawn.keys()) {
    const event = index.event(eventId);
    for (const tuplet of index.tupletChain(event)) {
      const members = tupletMembers.get(tuplet.id) ?? [];
      members.push(event);
      tupletMembers.set(tuplet.id, members);
    }
  }
  for (const [id, members] of tupletMembers) {
    const tuplet = index.tuplet(id);
    jobs.push({ layer: 6, order: nextOrder(), run: () => placeTuplet(tuplet, members) });
  }
}
