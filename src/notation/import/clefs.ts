/**
 * Clef-change inference, docs §7.9.
 *
 * A staff whose part ranges beyond its clef (a pianist's left hand climbing
 * over middle C) changes to an alternate clef rather than run on ledger
 * lines or take an octave line. Everything the staff draws at one position
 * is read in one clef:
 *
 * - a position fits the alternate clef when none of its notes needs more
 *   than `fitLedgers` ledger lines there, so a low bass note stays in the
 *   home clef whatever follows it;
 * - among the readings that fit, the one with the fewest ledger lines over
 *   the whole staff wins. A change of clef counts as `changeCost` ledger
 *   lines at a barline and as `splitCost` inside a measure, so a short
 *   excursion stays on ledger lines, a passage that stays away takes the
 *   other clef, and a measure is only split for chords far off the staff;
 * - equal readings keep the clef they are in and change at a barline rather
 *   than inside a measure. Silence keeps the clef it is reached in: a change
 *   is written where the next note needs it;
 * - the staff sets out from its home clef and is costed back to it, so an
 *   excursion at either end of the piece must earn both changes.
 *
 * The thresholds belong to the song's import settings, per staff.
 */
import * as F from '../core/fraction';
import type { Fraction } from '../core/fraction';
import { ScoreIndex } from '../model/query';
import type { ChordEvent, ClefChange, ClefKind, Score, StaffId } from '../model/types';
import { TOP_LINE, ledgerSteps, stepOf } from '../rules/staffPosition';

export interface ClefRule {
  /** The clef the staff changes to. */
  readonly alternate: ClefKind;
  /** Most ledger lines a note may need in the alternate clef. */
  readonly fitLedgers: number;
  /** Ledger lines a change of clef at a barline must save to be worth making. */
  readonly changeCost: number;
  /** The same for a change inside a measure. */
  readonly splitCost: number;
}

/** Added to a change inside a measure: too small to outweigh a ledger line, enough to break a tie. */
const SPLIT_TIE = 1e-6;

/** Everything a staff draws at one position. */
interface Moment {
  readonly measure: number;
  readonly offset: Fraction;
  /** The first position of its measure: a change before it sits at the barline. */
  readonly opens: boolean;
  /** Ledger lines in the home clef and in the alternate (infinite where it does not fit). */
  readonly cost: readonly number[];
}

/** Ledger lines drawn for notes struck together: those of the highest above the staff and of the lowest below. */
const ledgers = (steps: readonly number[]) =>
  ledgerSteps(Math.max(...steps)).filter(line => line > TOP_LINE).length + ledgerSteps(Math.min(...steps)).filter(line => line < 0).length;

export function inferClefChanges(score: Score, rules: Readonly<Record<StaffId, ClefRule>>): Score {
  const index = new ScoreIndex(score);
  const clefs: ClefChange[] = [];
  const staves = score.staves.map(staff => {
    const rule = rules[staff.id];
    if (!rule || rule.alternate === staff.clef) return staff;
    const options = [staff.clef, rule.alternate];
    const moments = momentsOn(index, staff.id, options, rule.fitLedgers);
    if (!moments.length) return staff;
    // Of two equal readings, the one that changes at a barline wins.
    const price = (moment: Moment) => moment.opens ? rule.changeCost : rule.splitCost + SPLIT_TIE;
    // The cheapest reading up to each moment, ending in each clef, and the clef it came from.
    // The staff sets out from its home clef and is costed back to it, so an excursion at either end must earn both changes.
    let best = [moments[0].cost[0], moments[0].cost[1] + rule.changeCost];
    const from: number[][] = [];
    for (const moment of moments.slice(1)) {
      const origin = options.map((_, option) => best[option] <= best[1 - option] + price(moment) ? option : 1 - option);
      best = options.map((_, option) => moment.cost[option] + best[origin[option]] + (origin[option] === option ? 0 : price(moment)));
      from.push(origin);
    }
    const chosen = [best[0] <= best[1] + rule.changeCost ? 0 : 1];
    for (let at = from.length - 1; at >= 0; at--) chosen.unshift(from[at][chosen[0]]);
    const used = new Map<string, number>();
    moments.forEach((moment, at) => {
      if (!at || chosen[at] === chosen[at - 1]) return;
      // A change is named after the measure it is in; later changes of the same measure are numbered.
      const name = `clef@${staff.id}.${moment.measure + 1}`;
      const count = (used.get(name) ?? 0) + 1;
      used.set(name, count);
      clefs.push({
        id: count === 1 ? name : `${name}.${count}`, staff: staff.id, measure: moment.measure,
        offset: moment.opens ? F.ZERO : moment.offset, clef: options[chosen[at]],
        provenance: { origin: 'inferred', rule: 'clef-ledgers' }
      });
    });
    return chosen[0] === 0 ? staff : { ...staff, clef: rule.alternate };
  });
  return { ...score, staves, clefs: [...score.clefs, ...clefs] };
}

/** What a staff draws, position by position: its own notes, and those crossing to it. */
function momentsOn(index: ScoreIndex, staff: StaffId, options: readonly ClefKind[], fitLedgers: number): Moment[] {
  const moments: Moment[] = [];
  for (let measure = 0; measure < index.measureCount; measure++) {
    const struck = new Map<string, { offset: Fraction; pitches: ChordEvent['notes'][number]['pitch'][] }>();
    for (const event of index.eventsIn(measure)) {
      if (event.kind !== 'chord') continue;
      const pitches = event.notes.filter(note => (note.staff ?? event.staff) === staff).map(note => note.pitch);
      if (!pitches.length) continue;
      const key = F.format(event.offset);
      if (struck.has(key)) struck.get(key)!.pitches.push(...pitches); else struck.set(key, { offset: event.offset, pitches });
    }
    [...struck.values()].sort((a, b) => F.compare(a.offset, b.offset)).forEach(({ offset, pitches }, at) => {
      const cost = options.map((clef, option) => {
        const steps = pitches.map(pitch => stepOf(pitch, clef));
        return option === 1 && steps.some(step => ledgerSteps(step).length > fitLedgers) ? Infinity : ledgers(steps);
      });
      moments.push({ measure, offset, opens: at === 0, cost });
    });
  }
  return moments;
}
