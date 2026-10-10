/**
 * Places every attachment and spanner on a line of music, docs §4 and §8.3.
 *
 * Marks are placed layer by layer, outward from the noteheads. Each starts
 * where its catalogue entry says (side, alignment, inside the staff or not)
 * and moves outward until it clears everything already on its staff; then it
 * becomes an obstacle for the marks after it. Marks that share a baseline
 * (dynamics, pedals, octave lines, tempo) are then lined up at the outermost
 * position any of them needed.
 */
import type { Box } from '../fonts/glyphs';
import type { StaffId } from '../model/types';
import type { SystemContext } from './context';
import { staffTop } from './context';
import { overlaps } from './display';
import { queueAttachments } from './marks/attachments';
import { CLEAR_STEP, markScope } from './marks/scope';
import type { Placed } from './marks/scope';
import { queueSpanners } from './marks/spanners';
import { queueTuplets } from './marks/tuplets';
import { queueVerticalSigns } from './marks/vertical';
import { ENGRAVING } from './settings';

export { TEXT_LOOKS } from './marks/scope';

export interface MarkResult {
  /** Extra room the gap below a staff needs for the marks placed in it. */
  readonly gapShortfall: Map<StaffId, number>;
}

export function placeMarks(context: SystemContext): MarkResult {
  const scope = markScope(context);
  const { builder, gapShortfall, staffInk, jobs, nextStaff, remember } = scope;

  // Queued in this order, which is also the order marks of one layer are placed in.
  queueAttachments(scope);
  const placeVertical = queueVerticalSigns(scope);
  queueTuplets(scope);
  queueSpanners(scope, placeVertical);

  jobs.sort((a, b) => a.layer - b.layer || a.order - b.order);
  const allPlaced: Placed[] = [];
  for (const layer of [...new Set(jobs.map(job => job.layer))]) {
    const placed: Placed[] = [];
    for (const job of jobs.filter(item => item.layer === layer)) {
      const result = job.run();
      if (!result) continue;
      placed.push(result);
      allPlaced.push(result);
      remember(result);
    }
    const baselineGroups = new Map<string, Placed[]>();
    for (const item of placed) {
      if (!item.baseline) continue;
      const groupKey = `${item.baseline}:${item.staff}:${item.side}`;
      (baselineGroups.get(groupKey) ?? baselineGroups.set(groupKey, []).get(groupKey)!).push(item);
    }
    for (const members of baselineGroups.values()) {
      const above = members[0].side === 'above';
      const target = above ? Math.min(...members.map(item => item.reference)) : Math.max(...members.map(item => item.reference));
      // Members share the baseline unless that would put two of them on top of each other;
      // then the later one moves further out.
      const aligned: Box[] = [];
      for (const member of [...members].sort((a, b) => a.box.x0 - b.box.x0)) {
        let dy = target - member.reference;
        for (let guard = 0; guard < 20; guard++) {
          const moved = { ...member.box, y0: member.box.y0 + dy, y1: member.box.y1 + dy };
          const hit = aligned.find(box => overlaps(moved, box, 0.3));
          if (!hit) break;
          dy += above ? hit.y0 - 0.3 - moved.y1 - CLEAR_STEP : hit.y1 + 0.3 - moved.y0 + CLEAR_STEP;
        }
        if (Math.abs(dy) > 1e-6) {
          member.items = builder.shift(member.items, dy);
          member.box = { ...member.box, y0: member.box.y0 + dy, y1: member.box.y1 + dy };
          member.reference += dy;
          remember(member);
        }
        aligned.push(member.box);
      }
    }
  }
  // Check the completed layout, including marks above the lower staff.
  for (const item of allPlaced) {
    const next = item.side === 'below' ? nextStaff(item.staff) : undefined;
    if (!next) continue;
    const lowerInk = [...staffInk.get(next)!, ...allPlaced
      .filter(mark => mark.staff === next && mark.side === 'above').map(mark => mark.box)];
    const inkTop = Math.min(staffTop(context, next), ...lowerInk
      .filter(box => box.x0 < item.box.x1 && box.x1 > item.box.x0)
      .map(box => box.y0));
    const room = inkTop - ENGRAVING.staffClearance - item.box.y1;
    if (room < 0) gapShortfall.set(item.staff, Math.max(gapShortfall.get(item.staff) ?? 0, -room));
  }
  return { gapShortfall };
}
