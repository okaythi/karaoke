/** Marks that run from one anchor to another: slurs, hairpins, pedal and octave lines. */
import * as F from '../../core/fraction';
import { entry } from '../../catalogue/registry';
import type { Decoration, SpannerEntry } from '../../catalogue/types';
import { glyph, measureText } from '../../fonts/glyphs';
import type { ChordEvent, ScoreEvent, Spanner } from '../../model/types';
import type { DisplayItem, Semantic } from '../display';
import { union } from '../display';
import { inSystem, staffTop } from '../context';
import { clearingHeight, drawCurve, slurEnd, slurSide } from '../curves';
import { semanticOf } from '../notes';
import { ENGRAVING } from '../settings';
import { DECORATION_SCALE, TEXT_LOOKS, label } from './scope';
import type { queueVerticalSigns } from './vertical';
import type { Placed, MarkScope } from './scope';

export function queueSpanners(scope: MarkScope, placeVertical: ReturnType<typeof queueVerticalSigns>): void {
  const { context, builder, index, staves, obstacles, clearShift, settle, sideFor, eventOf, measureOf, barlineX, nextColumnX, jobs, nextOrder } = scope;

  const placeSlur = (spanner: Spanner, known: SpannerEntry): Placed | undefined => {
    const start = eventOf(spanner.start), end = eventOf(spanner.end);
    if (!start || !end) return undefined;
    const startDrawn = context.drawn.get(start.id), endDrawn = context.drawn.get(end.id);
    const from = index.absolute(start.measure, start.offset), to = index.absolute(end.measure, end.offset);
    const under = index.score.events.filter((event): event is ChordEvent => event.kind === 'chord' && event.staff === start.staff &&
      event.voice === start.voice && F.ge(index.absolute(event.measure, event.offset), from) && F.le(index.absolute(event.measure, event.offset), to));
    const side = slurSide(context, spanner, under);
    const staff = start.staff;
    const top = staffTop(context, staff);
    const fallbackY = side === 'above' ? top - 1 : top + 5;
    let p0 = startDrawn ? slurEnd(startDrawn, side, true) : undefined;
    let p1 = endDrawn ? slurEnd(endDrawn, side, false) : undefined;
    p0 ??= { x: context.contentStart - 0.5, y: p1?.y ?? fallbackY };
    p1 ??= { x: context.contentEnd + 0.6, y: p0.y };
    const relevant = obstacles.get(staff)!.filter(box => box.x1 > p0!.x + 0.3 && box.x0 < p1!.x - 0.3);
    const scale = startDrawn?.scale ?? 1;
    const minimum = Math.max(0.7, Math.min(2.2, 0.5 + (p1.x - p0.x) * 0.08)) / 0.75;
    const { height, lift } = clearingHeight(p0, p1, relevant, side, minimum, Math.max(minimum, 4.5), 0.3);
    const sign = side === 'above' ? -1 : 1;
    const before = builder.items.length;
    const box = drawCurve(context, { x: p0.x, y: p0.y + sign * lift }, { x: p1.x, y: p1.y + sign * lift }, height,
      label(known.id, [spanner.id], semanticOf(start)),
      { middle: ENGRAVING.slurMidpointThickness * scale, end: ENGRAVING.slurEndpointThickness * scale });
    return { items: builder.items.slice(before), box, staff, side, reference: box.y0 };
  };

  const placeLine = (spanner: Spanner, known: SpannerEntry): Placed | undefined => {
    const drawing = known.drawing;
    if (drawing.type !== 'line') return undefined;
    const start = eventOf(spanner.start), end = eventOf(spanner.end);
    const startMeasure = measureOf(spanner.start), endMeasure = measureOf(spanner.end);
    const startBar = barlineX(spanner.start), endBar = barlineX(spanner.end);
    const startsHere = start ? inSystem(context, startMeasure) : startBar !== undefined;
    const endsHere = end ? inSystem(context, endMeasure) : endBar !== undefined;
    const { staff, side } = sideFor(known.side, spanner.staff ?? start?.staff ?? end?.staff ?? staves[0], start, spanner.side);
    const semantic: Semantic = start ? semanticOf(start, staff) : { staff };
    const refs = [spanner.id];
    const element = known.id;
    const make = (glyphLabel = element) => label(glyphLabel, refs, semantic);

    // Glissandi run from notehead to notehead and are not stacked.
    if ('note' in spanner.start && 'note' in spanner.end) {
      const a = index.note(spanner.start.note), b = index.note(spanner.end.note);
      const boxA = context.drawn.get(a.event.id)?.noteBoxes.get(a.note.id), boxB = context.drawn.get(b.event.id)?.noteBoxes.get(b.note.id);
      if (!boxA || !boxB) return undefined;
      const item = builder.line(boxA.x1 + 0.4, (boxA.y0 + boxA.y1) / 2, boxB.x0 - 0.6, (boxB.y0 + boxB.y1) / 2, ENGRAVING.octaveLineThickness, make());
      return { items: [item], box: item.box, staff, side, reference: 0 };
    }

    const startDrawn = start ? context.drawn.get(start.id) : undefined;
    const endDrawn = end ? context.drawn.get(end.id) : undefined;
    // A dynamic on the first note of a span comes first, and the span follows it.
    const dynamicOn = (event: ScoreEvent) => builder.items.find(item => item.element.startsWith('dyn.') && !item.element.startsWith('dyn.hairpin') &&
      !item.element.startsWith('dyn.text') && item.refs.includes(event.id) && item.refs[0] !== spanner.id && item.primitive.kind === 'glyph');
    const startDynamic = startsHere && start && known.baseline === 'dynamics' ? dynamicOn(start) : undefined;
    const x0 = startsHere ? Math.max(startDrawn?.heads.x0 ?? startBar ?? context.contentStart, startDynamic ? startDynamic.box.x1 + 0.6 : -Infinity)
      : context.contentStart;
    let x1 = context.contentEnd - 0.4;
    if (endsHere) {
      if (endDrawn) {
        if (known.endsAt === 'onset') x1 = endDrawn.heads.x0 - 0.2;
        else if (drawing.extent === 'duration') x1 = Math.max(endDrawn.heads.x1 + 0.2, nextColumnX(end!) - 0.8);
        else x1 = endDrawn.heads.x1 + 0.2;
      }
      else if (endBar !== undefined) x1 = endBar - 0.3;
      // A hairpin stops short of a dynamic on its last note.
      const endDynamic = end && known.baseline === 'dynamics' ? dynamicOn(end) : undefined;
      if (endDynamic) x1 = Math.min(x1, endDynamic.box.x0 - 0.6);
    }
    const top = staffTop(context, staff);
    const lineY = side === 'above' ? top - 2 : top + 6;
    const items: DisplayItem[] = [];
    let lineStart = x0, lineEnd = x1;
    const decorate = (decoration: Decoration | undefined, at: number, atEnd: boolean): void => {
      if (!decoration) return;
      if (decoration.kind === 'hook') {
        const toward = (decoration.toward === 'staff') === (side === 'above') ? 1 : -1;
        items.push(builder.line(at, lineY, at, lineY + toward * 0.9, ENGRAVING.octaveLineThickness, make()));
      } else if (decoration.kind === 'glyph') {
        const name = side === 'below' && decoration.below ? decoration.below : decoration.glyph;
        const scale = DECORATION_SCALE;
        const box = glyph(name).box;
        const gy = lineY - ((box.y0 + box.y1) / 2) * scale;
        let gx = atEnd ? at - (box.x1 - box.x0) * scale : at;
        if (decoration.parenthesize) {
          const open = builder.text('(', gx, gy, 'Academico', 2.2, make(), { italic: true });
          items.push(open);
          gx = open.box.x1 + 0.05;
        }
        const mark = builder.glyph(name, gx - box.x0 * scale, gy, make(), { scale });
        items.push(mark);
        let right = mark.box.x1;
        if (decoration.parenthesize) {
          const close = builder.text(')', right + 0.05, gy, 'Academico', 2.2, make(), { italic: true });
          items.push(close);
          right = close.box.x1;
        }
        if (atEnd) lineEnd = Math.min(lineEnd, gx - 0.4); else lineStart = Math.max(lineStart, right + 0.4);
      } else if (decoration.kind === 'text') {
        const look = TEXT_LOOKS[decoration.style];
        const raw = (atEnd ? undefined : spanner.text) ?? decoration.default ?? '';
        const text = decoration.parenthesize ? `(${raw})` : raw;
        const metrics = measureText(text, look.face, look.size);
        const item = builder.text(text, at, lineY + metrics.ascent / 2, look.face, look.size, make(), { italic: look.italic, anchor: atEnd ? 'end' : 'start' });
        items.push(item);
        if (atEnd) lineEnd = Math.min(lineEnd, item.box.x0 - 0.4); else lineStart = Math.max(lineStart, item.box.x1 + 0.5);
      }
    };
    decorate(startsHere ? drawing.start : drawing.continuation, x0, false);
    if (startsHere && drawing.label && spanner.text) {
      // A bracket's label sits inside it, just after the opening hook.
      const look = TEXT_LOOKS[drawing.label];
      const metrics = measureText(spanner.text, look.face, look.size);
      const ty = side === 'above' ? lineY + 0.4 + metrics.ascent : lineY - 0.4;
      items.push(builder.text(spanner.text, x0 + 0.5, ty, look.face, look.size, make(), { italic: look.italic }));
    }
    // Over a single note the line still runs two dashes past its opening mark, so the hook stands clear of it.
    if (endsHere && drawing.end?.kind === 'hook' && lineStart > x0)
      lineEnd = x1 = Math.max(x1, lineStart + 2 * ENGRAVING.lineDashLength + ENGRAVING.lineDashGap);
    if (endsHere && spanner.params?.open !== true) decorate(drawing.end, x1, true);
    const thickness = known.family === 'pedal' ? ENGRAVING.pedalLineThickness : known.family === 'dyn' ? ENGRAVING.hairpinThickness : ENGRAVING.octaveLineThickness;
    if (lineEnd > lineStart + 0.2) {
      switch (drawing.line) {
        case 'solid': items.push(builder.line(lineStart, lineY, lineEnd, lineY, thickness, make())); break;
        case 'dashed': items.push(builder.line(lineStart, lineY, lineEnd, lineY, thickness, make(), { dash: [ENGRAVING.lineDashLength, ENGRAVING.lineDashGap] })); break;
        case 'wiggle': {
          const wiggle = glyph('wiggleTrill');
          for (let at = lineStart; at + wiggle.advance <= lineEnd + 0.01; at += wiggle.advance)
            items.push(builder.glyph('wiggleTrill', at, lineY - (wiggle.box.y0 + wiggle.box.y1) / 2, make()));
          break;
        }
        case 'hairpin-open': case 'hairpin-close': {
          const opening = lineEnd - lineStart > 10 ? 1 : 0.75;
          const growing = drawing.line === 'hairpin-open';
          // A hairpin continued from the previous line restarts slightly open.
          const startOpen = growing ? (startsHere ? 0 : opening * 0.4) : opening;
          const endOpen = growing ? opening : (endsHere ? 0 : opening * 0.4);
          items.push(builder.line(lineStart, lineY - startOpen / 2, lineEnd, lineY - endOpen / 2, thickness, make()));
          items.push(builder.line(lineStart, lineY + startOpen / 2, lineEnd, lineY + endOpen / 2, thickness, make()));
          break;
        }
        case 'none': break;
      }
      if (drawing.line === 'solid' && known.family === 'pedal') {
        // Pedal changes inside a bracket: a notch up toward the staff.
        for (const change of index.score.attachments) {
          if (change.kind !== 'pedal.change') continue;
          const at = eventOf(change.anchor);
          const drawnChange = at ? context.drawn.get(at.id) : undefined;
          if (!drawnChange || at!.staff !== start?.staff || drawnChange.heads.x0 <= lineStart || drawnChange.heads.x0 >= lineEnd) continue;
          const nx = drawnChange.heads.x0;
          const notch = label('pedal.change', [change.id], semantic);
          items.push(builder.line(nx - 0.45, lineY, nx, lineY - 0.8, thickness, notch));
          items.push(builder.line(nx, lineY - 0.8, nx + 0.45, lineY, thickness, notch));
        }
      }
    }
    if (!items.length) return undefined;
    // Hairpins line up with dynamics: their centre at the dynamics' middle height.
    const reference = known.baseline === 'dynamics' ? lineY + 0.55 : lineY;
    const box = items.map(item => item.box).reduce(union);
    return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: known.layer >= 4 }), reference, known.baseline);
  };

  for (const spanner of index.score.spanners) {
    const known = entry(spanner.kind) as SpannerEntry;
    const drawing = known.drawing;
    if (spanner.kind === 'tie' || drawing.type === 'structure') continue;
    if (measureOf(spanner.end) < context.plan.first || measureOf(spanner.start) > context.plan.last) continue;
    if (drawing.type === 'vertical') {
      const events = [eventOf(spanner.start), eventOf(spanner.end)].filter((event): event is ScoreEvent => !!event);
      jobs.push({ layer: 0, order: nextOrder(), run: () => placeVertical(known, spanner.id, events) });
    } else if (drawing.type === 'curve') {
      jobs.push({ layer: known.layer, order: nextOrder(), run: () => placeSlur(spanner, known) });
    } else {
      // Line spanners go after the attachments of their layer, so hairpins see the dynamics they end at.
      jobs.push({ layer: known.layer, order: 1e6 + nextOrder(), run: () => placeLine(spanner, known) });
    }
  }
}
