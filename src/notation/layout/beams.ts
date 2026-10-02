/**
 * Beam geometry, docs §5.5 and §6.4.
 *
 * The beam slants with the outer notes of the group, by at most one staff
 * space, and lies flat when the group starts and ends on one pitch or when an
 * inner note reaches further toward the beam than both ends. It then moves
 * away from the noteheads until every stem is long enough for its beams.
 * Stems end at the outer edge of the primary beam; further beams stack toward
 * the noteheads. A lone short note inside a group gets a stub pointing at the
 * note it belongs with.
 */
import type { ChordEvent, Spanner } from '../model/types';
import { flagCount } from '../model/time';
import type { SystemContext } from './context';
import { drawSlash, drawStem, semanticOf } from './notes';
import { ENGRAVING } from './settings';
import type { BeamPlan, ChordShape } from './shapes';

export function drawBeams(context: SystemContext, plan: BeamPlan): void {
  const members = plan.events.map(event => ({ event, drawn: context.drawn.get(event.id), shape: context.prepared.shapes.get(event.id) as ChordShape }));
  if (members.some(member => !member.drawn?.stem)) return;
  const up = plan.stem === 'up';
  const scale = members[0].shape.scale;
  const thickness = ENGRAVING.beamThickness * scale;
  const step = (ENGRAVING.beamThickness + ENGRAVING.beamSpacing) * scale;
  const beamCount = (event: ChordEvent) => flagCount(event.value.base);
  const maxBeams = Math.max(...members.map(member => beamCount(member.event)));

  // Near notehead: the one the beam must clear.
  const near = members.map(member => {
    const boxes = [...member.drawn!.noteBoxes.values()];
    return up ? Math.min(...boxes.map(box => (box.y0 + box.y1) / 2)) : Math.max(...boxes.map(box => (box.y0 + box.y1) / 2));
  });
  const xs = members.map(member => member.drawn!.stem!.x);
  const first = 0, last = members.length - 1;
  const span = xs[last] - xs[first] || 1;
  const direction = up ? -1 : 1;
  const ideal = near.map(y => y + direction * ENGRAVING.stemLength * scale);

  let rise = ideal[last] - ideal[first];
  const inner = near.slice(1, -1);
  const innerReachesFurther = inner.length > 0 &&
    (up ? Math.min(...inner) < Math.min(near[first], near[last]) : Math.max(...inner) > Math.max(near[first], near[last]));
  if (Math.abs(near[last] - near[first]) < 1e-6 || innerReachesFurther) rise = 0;
  const limit = Math.min(ENGRAVING.maxBeamSlant * scale, Math.abs(near[last] - near[first]) / 2 || 0);
  rise = Math.max(-limit, Math.min(limit, rise));
  const slope = rise / span;

  // Move the beam outward until every stem reaches it with room for its beams.
  let intercept = ideal[first];
  const lineAt = (x: number) => intercept + slope * (x - xs[first]);
  members.forEach((member, position) => {
    const needed = (ENGRAVING.minBeamedStem + (beamCount(member.event) - 1) * (ENGRAVING.beamThickness + ENGRAVING.beamSpacing)) * scale;
    const limitY = near[position] + direction * needed;
    const at = lineAt(xs[position]);
    if (up ? at > limitY : at < limitY) intercept += limitY - at;
  });

  for (const member of members) {
    const stem = member.drawn!.stem!;
    stem.tipY = lineAt(stem.x);
    drawStem(context, member.event, member.shape, member.drawn!);
  }
  const graceSlash = members[0].event.grace?.kind === 'acciaccatura';
  if (graceSlash) drawSlash(context, members[0].event, members[0].shape, members[0].drawn!);

  const half = (ENGRAVING.stemThickness * scale) / 2;
  const semantic = semanticOf(members[0].event);
  const refs = members.map(member => member.event.id);
  const polygon = (x0: number, x1: number, level: number) => {
    const offset = -direction * level * step;
    const y0 = lineAt(x0) + offset, y1 = lineAt(x1) + offset;
    const inward = -direction * thickness;
    context.builder.polygon([x0, y0, x1, y1, x1, y1 + inward, x0, y0 + inward], { element: 'note.beam', refs, semantic });
  };
  polygon(xs[first] - half, xs[last] + half, 0);

  for (let level = 1; level < maxBeams; level++) {
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) polygon(xs[run[0]] - half, xs[run.at(-1)!] + half, level);
      else if (run.length === 1) {
        const position = run[0];
        const stub = Math.min(1.1 * scale, span / members.length);
        // A stub points to the note it belongs with: right at the start of a sub-group, left otherwise.
        const startsGroup = position === 0 || plan.breaks.has(position);
        const endsGroup = position === last || plan.breaks.has(position + 1);
        const pointLeft = endsGroup && !startsGroup ? true : position === last;
        const x = xs[position];
        if (pointLeft) polygon(x - stub, x + half, level); else polygon(x - half, x + stub, level);
      }
      run = [];
    };
    members.forEach((member, position) => {
      const breaks = level >= 1 && plan.breaks.has(position);
      if (breaks) flush();
      if (beamCount(member.event) > level) run.push(position); else flush();
    });
    flush();
  }
}

/**
 * Two-note tremolo: beams that float between two notes of the full value,
 * aimed along the line joining them, never touching the stems.
 */
export function drawTremoloBetween(context: SystemContext, spanner: Spanner): void {
  if (!('event' in spanner.start) || !('event' in spanner.end)) return;
  const first = context.drawn.get(spanner.start.event), second = context.drawn.get(spanner.end.event);
  if (!first || !second) return;
  const anchor = (drawn: NonNullable<typeof first>) => drawn.stem
    ? { x: drawn.stem.x, y: (drawn.stem.baseY + drawn.stem.tipY) / 2 + (drawn.stem.direction === 'up' ? -0.5 : 0.5) }
    : { x: (drawn.heads.x0 + drawn.heads.x1) / 2, y: drawn.heads.y0 - 2 };
  const a = anchor(first), b = anchor(second);
  const strokes = Number(spanner.params?.strokes ?? 3);
  const x0 = a.x + 0.7, x1 = b.x - 0.7;
  if (x1 <= x0) return;
  const slope = Math.max(-0.25, Math.min(0.25, (b.y - a.y) / (b.x - a.x)));
  const thickness = ENGRAVING.beamThickness, gap = ENGRAVING.beamThickness + ENGRAVING.beamSpacing;
  const event = context.prepared.index.event(spanner.start.event);
  for (let n = 0; n < strokes; n++) {
    const offset = (n - (strokes - 1) / 2) * gap;
    const y0 = a.y + offset + slope * (x0 - a.x), y1 = a.y + offset + slope * (x1 - a.x);
    context.builder.polygon([x0, y0 - thickness / 2, x1, y1 - thickness / 2, x1, y1 + thickness / 2, x0, y0 + thickness / 2],
      { element: 'orn.tremolo-between', refs: [spanner.id], semantic: semanticOf(event) });
  }
}
