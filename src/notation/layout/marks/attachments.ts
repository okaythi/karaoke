/** Marks attached to one event or barline: articulations, dynamics, text, metronome marks. */
import { entry } from '../../catalogue/registry';
import type { AttachmentEntry } from '../../catalogue/types';
import { glyph, measureText } from '../../fonts/glyphs';
import type { Box } from '../../fonts/glyphs';
import type { Attachment, ScoreEvent, StaffId } from '../../model/types';
import type { DisplayItem, Semantic } from '../display';
import { union } from '../display';
import type { DrawnEvent } from '../context';
import { inSystem, staffTop } from '../context';
import { semanticOf } from '../notes';
import { ENGRAVING, SIZE_SCALE } from '../settings';
import { METRONOME_UNITS, TEXT_LOOKS, label, stemBox } from './scope';
import type { Placed, Side, TextLook, MarkScope } from './scope';

export function queueAttachments(scope: MarkScope): void {
  const { context, prepared, builder, index, staves, clearShift, settle, sideFor, eventOf, measureOf, barlineX, nextColumnX, glyphFor, jobs, nextOrder } = scope;

  const placeAttachment = (attachment: Attachment, known: AttachmentEntry, event: ScoreEvent | undefined,
    drawn: DrawnEvent | undefined, barline: number | undefined): Placed | undefined => {
    const drawing = known.drawing;
    let anchorStaff = event?.staff ?? staves[0];
    let noteBox: Box | undefined;
    if ('note' in attachment.anchor && drawn) {
      const ref = index.note(attachment.anchor.note);
      anchorStaff = prepared.drawnStaff(ref.event, ref.note.id);
      noteBox = drawn.noteBoxes.get(ref.note.id);
    }
    const { staff, side } = sideFor(known.side, anchorStaff, event, attachment.side);
    const semantic: Semantic = event ? semanticOf(event, staff) : { staff };
    const refs = [attachment.id, ...(event ? [event.id] : [])];
    const align = drawing.type === 'glyph' || drawing.type === 'text' ? drawing.align : 'event';
    const shape = event ? prepared.shapes.get(event.id) : undefined;
    const chord = shape?.kind === 'chord' ? shape : undefined;
    const onStemSide = !!(chord?.stem && drawn?.stem && ((chord.stem === 'up') === (side === 'above')));
    const top = staffTop(context, staff);

    let x = barline ?? context.contentStart;
    if (drawn) {
      const normalHead = chord?.heads.find(head => !head.displaced);
      const headCentre = normalHead ? drawn.x + normalHead.dx + normalHead.width / 2 : (drawn.heads.x0 + drawn.heads.x1) / 2;
      switch (align) {
        case 'event': x = noteBox ? (noteBox.x0 + noteBox.x1) / 2 : onStemSide && known.layer <= 2 ? drawn.stem!.x : headCentre; break;
        case 'stem': x = drawn.stem?.x ?? headCentre; break;
        case 'event-left': {
          // Words follow a dynamic already set on the same note (p dolce, subito ff).
          const before = known.baseline !== 'dynamics' ? [] : builder.items.filter(item => item.refs.includes(drawn.eventId) &&
            item.refs[0] !== attachment.id && item.element.startsWith('dyn.') && !item.element.startsWith('dyn.hairpin') && item.semantic.staff === staff);
          x = before.length ? Math.max(drawn.heads.x0, ...before.map(item => item.box.x1 + 0.5)) : drawn.heads.x0;
          break;
        }
        case 'event-right': x = drawn.heads.x1 + 0.4; break;
        case 'after': x = (drawn.heads.x1 + nextColumnX(event!)) / 2; break;
        case 'measure': { const placement = context.measures.get(event!.measure)!; x = (placement.start + placement.end) / 2; break; }
        case 'measure-start': x = context.measures.get(event!.measure)!.start; break;
        default: x = headCentre;
      }
    } else if ('barline' in attachment.anchor && align === 'measure') {
      const placement = context.measures.get(attachment.anchor.barline.measure);
      if (placement) x = (placement.start + placement.end) / 2;
    }

    if (drawing.type === 'glyph') {
      const name = glyphFor(drawing, side, attachment.params);
      const smallOnly = known.sizes.includes('small-text') && !known.sizes.includes('full');
      const scale = smallOnly ? SIZE_SCALE['small-text'] : known.layer <= 2 && drawn ? drawn.scale : 1;
      const box = glyph(name).box;
      const width = (box.x1 - box.x0) * scale;
      const centred = align !== 'event-left' && align !== 'event-right' && align !== 'measure-start';
      const gx = centred ? x - width / 2 - box.x0 * scale : x - box.x0 * scale;

      if (align === 'stem') {
        // Tremolo strokes cross the stem between notehead and tip; on a whole note, where the stem would be.
        const stem = drawn?.stem;
        const y = stem ? (stem.baseY + stem.tipY) / 2 + (stem.direction === 'up' ? 0.3 : -0.3) : (drawn ? drawn.heads.y0 - 2 : top);
        const item = builder.glyph(name, (stem?.x ?? x) - ((box.x0 + box.x1) / 2) * scale, y, label(known.id, refs, semantic), { scale });
        return { items: [item], box: item.box, staff, side, reference: y };
      }
      if (known.side === 'through') {
        const y = known.id === 'nav.bar-repeat' ? top + 2 : top + 1;
        const item = builder.glyph(name, gx, y, label(known.id, refs, semantic), { scale });
        return { items: [item], box: item.box, staff, side, reference: y };
      }
      const anchorBox = noteBox ?? (onStemSide && drawn?.stem ? stemBox(drawn) : drawn?.heads);
      const edge = side === 'above' ? (anchorBox?.y0 ?? top) - 0.3 : (anchorBox?.y1 ?? top + 4) + 0.3;
      const y = side === 'above' ? edge - box.y1 * scale : edge - box.y0 * scale;
      const item = builder.glyph(name, gx, y, label(known.id, refs, semantic), { scale });
      if (drawing.inside && !onStemSide) {
        // Inside the staff a mark centres in a space, never on a line, and only moves outward.
        const centreOf = (dy: number) => (item.box.y0 + item.box.y1) / 2 + dy;
        const snap = (dy: number) => {
          const centre = centreOf(dy);
          if (centre <= top || centre >= top + 4) return dy;
          const spaces = [0.5, 1.5, 2.5, 3.5].map(offset => top + offset)
            .filter(space => (side === 'above' ? space <= centre + 1e-6 : space >= centre - 1e-6));
          if (!spaces.length) return dy + (side === 'above' ? top - 0.6 - item.box.y1 - dy : top + 4.6 - item.box.y0 - dy);
          const target = side === 'above' ? Math.max(...spaces) : Math.min(...spaces);
          return dy + target - centre;
        };
        return settle([item], staff, side, clearShift(item.box, staff, side, { snap }), y, known.baseline);
      }
      return settle([item], staff, side, clearShift(item.box, staff, side, { outside: true, contour: known.layer >= 4 }), y, known.baseline);
    }

    if (drawing.type === 'text') {
      const look = TEXT_LOOKS[drawing.style];
      if (drawing.content === 'metronome') return placeMetronome(attachment, x, staff, side, semantic, refs, look);
      const text = attachment.text ?? drawing.default ?? '';
      const metrics = measureText(text, look.face, look.size);
      const anchor = align === 'event' || align === 'barline' || align === 'measure' ? 'middle' : align === 'before-barline' ? 'end' : 'start';
      const y = side === 'above' ? top - 1 : top + 5 + metrics.ascent;
      const items = [builder.text(text, align === 'before-barline' ? x - 0.4 : x, y, look.face, look.size, label(known.id, refs, semantic),
        { italic: look.italic, anchor })];
      if (drawing.enclosure === 'box') {
        const pad = 0.4, box = items[0].box;
        items.push(builder.rect(box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2,
          ENGRAVING.textEnclosureThickness, label(known.id, refs, semantic)));
      }
      const box = items.map(item => item.box).reduce(union);
      return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: known.layer >= 4 }), y, known.baseline);
    }
    return undefined;
  };

  const placeMetronome = (attachment: Attachment, x: number, staff: StaffId, side: Side, semantic: Semantic,
    refs: readonly string[], look: TextLook): Placed => {
    const unit = METRONOME_UNITS[String(attachment.params?.unit ?? 'quarter')] ?? METRONOME_UNITS.quarter;
    // Tempo words on the same event come first; the mark follows on their baseline.
    const event = eventOf(attachment.anchor);
    const words = builder.items.filter(item => item.element === 'tempo.text' && event && item.refs.includes(event.id));
    const y = words[0]?.primitive.kind === 'text' ? words[0].primitive.y : staffTop(context, staff) - 1;
    let at = words.length ? Math.max(...words.map(item => item.box.x1)) + 1 : x;
    const items: DisplayItem[] = [];
    const scale = 0.85;
    if (words.length) {
      const open = builder.text('(', at, y, look.face, look.size, label('tempo.metronome', refs, semantic));
      items.push(open);
      at = open.box.x1 + 0.1;
    }
    items.push(builder.glyph(unit.glyph, at, y, label('tempo.metronome', refs, semantic), { scale }));
    at += glyph(unit.glyph).advance * scale + 0.15;
    if (unit.dot) {
      items.push(builder.glyph('metAugmentationDot', at, y, label('tempo.metronome', refs, semantic), { scale }));
      at += glyph('metAugmentationDot').advance * scale + 0.15;
    }
    items.push(builder.text(` = ${attachment.params?.bpm ?? ''}${words.length ? ')' : ''}`, at, y, 'Academico', look.size, label('tempo.metronome', refs, semantic)));
    const box = items.map(item => item.box).reduce(union);
    if (words.length) return { items, box, staff, side, reference: y };
    return settle(items, staff, side, clearShift(box, staff, side, { outside: true, contour: true }), y, 'tempo');
  };

  for (const attachment of index.score.attachments) {
    const known = entry(attachment.kind) as AttachmentEntry;
    const type = known.drawing.type;
    if (type !== 'glyph' && type !== 'text') continue;
    const barline = barlineX(attachment.anchor);
    if (!inSystem(context, measureOf(attachment.anchor)) && barline === undefined) continue;
    const event = eventOf(attachment.anchor);
    const drawn = event ? context.drawn.get(event.id) : undefined;
    if (event && !drawn) continue;
    jobs.push({ layer: known.layer, order: nextOrder(), run: () => placeAttachment(attachment, known, event, drawn, barline) });
  }
}
