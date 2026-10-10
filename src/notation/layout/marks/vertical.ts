/** Signs drawn up the side of a chord, such as arpeggios. */
import { entry } from '../../catalogue/registry';
import type { CatalogueEntry } from '../../catalogue/types';
import { glyph } from '../../fonts/glyphs';
import type { ScoreEvent } from '../../model/types';
import type { DisplayItem } from '../display';
import { union } from '../display';
import type { DrawnEvent } from '../context';
import { semanticOf } from '../notes';
import { ENGRAVING } from '../settings';
import { label } from './scope';
import type { Placed, MarkScope } from './scope';

export function queueVerticalSigns(scope: MarkScope) {
  const { context, prepared, builder, index, eventOf, jobs, nextOrder } = scope;

  const placeVertical = (known: CatalogueEntry, ref: string, events: readonly ScoreEvent[]): Placed | undefined => {
    const drawing = known.drawing;
    if (drawing.type !== 'vertical') return undefined;
    const drawnEvents = events.map(event => context.drawn.get(event.id)).filter((item): item is DrawnEvent => !!item);
    if (!drawnEvents.length) return undefined;
    const top = Math.min(...drawnEvents.map(item => item.heads.y0)) - 0.3;
    const bottom = Math.max(...drawnEvents.map(item => item.heads.y1)) + 0.3;
    const leftInk = Math.min(...drawnEvents.map(item => {
      const shape = prepared.shapes.get(item.eventId);
      return item.x + (shape?.kind === 'chord' ? Math.min(shape.left, 0) : 0);
    }));
    const semantic = semanticOf(events[0]);
    const refs = [ref, ...events.map(event => event.id)];
    const items: DisplayItem[] = [];
    if (drawing.bracket) {
      const x = leftInk - 0.5, thickness = ENGRAVING.tupletBracketThickness;
      items.push(builder.line(x, top, x, bottom, thickness, label(known.id, refs, semantic)));
      items.push(builder.line(x, top, x + 0.45, top, thickness, label(known.id, refs, semantic)));
      items.push(builder.line(x, bottom, x + 0.45, bottom, thickness, label(known.id, refs, semantic)));
    } else {
      // SMuFL draws arpeggio wiggles horizontally; they are turned to run up (or down) the chord.
      const segment = glyph(drawing.segment);
      // Turned a quarter turn, the wiggle runs upward from its origin. An upward
      // arrow caps the top; a downward arrow starts the line at the bottom.
      const up = drawing.cap?.up, down = drawing.cap?.down;
      const capLength = (up ? glyph(up).advance : 0) + (down ? glyph(down).advance : 0);
      const count = Math.max(1, Math.round((bottom - top - capLength) / segment.advance));
      const originX = leftInk - 0.35;
      const rotate = -90;
      let y = bottom;
      if (down) { items.push(builder.glyph(down, originX, y, label(known.id, refs, semantic), { rotate })); y -= glyph(down).advance; }
      for (let n = 0; n < count; n++, y -= segment.advance)
        items.push(builder.glyph(drawing.segment, originX, y, label(known.id, refs, semantic), { rotate }));
      if (up) items.push(builder.glyph(up, originX, y, label(known.id, refs, semantic), { rotate }));
    }
    return { items, box: items.map(item => item.box).reduce(union), staff: events[0].staff, side: 'above', reference: top };
  };

  for (const attachment of index.score.attachments) {
    const known = entry(attachment.kind);
    const event = known.drawing.type === 'vertical' ? eventOf(attachment.anchor) : undefined;
    if (event && context.drawn.has(event.id)) jobs.push({ layer: 0, order: nextOrder(), run: () => placeVertical(known, attachment.id, [event]) });
  }

  return placeVertical;
}
