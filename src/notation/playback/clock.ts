/**
 * The performed beat clock, docs §10: media time at any score position.
 *
 * Beats that carry an attack take the median onset of their notes; beats
 * without one (sustains, rests) are interpolated between their neighbours,
 * and the ends are extrapolated from the nearest known tempo. Transcription
 * noise can put a beat at or before its predecessor; such beats are dropped
 * and filled by interpolation instead. Positions are in whole notes from the
 * start of the score.
 */
export interface BeatClock {
  timeAt(position: number): number;
  positionAt(time: number): number;
  /** Beat positions and their times, for storage and inspection. */
  readonly beats: readonly { readonly position: number; readonly time: number }[];
}

export interface Attack {
  /** Score position of the attack, in whole notes. */
  readonly position: number;
  readonly time: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * `beatPositions` lists every beat of the score in order (from the meter),
 * ending with the position of the score's end.
 */
export function buildBeatClock(beatPositions: readonly number[], attacks: readonly Attack[]): BeatClock {
  const byBeat = new Map<number, number[]>();
  const indexOf = new Map(beatPositions.map((position, index) => [position.toFixed(9), index]));
  for (const attack of attacks) {
    const index = indexOf.get(attack.position.toFixed(9));
    if (index === undefined) continue;
    (byBeat.get(index) ?? byBeat.set(index, []).get(index)!).push(attack.time);
  }
  const known: { beat: number; time: number }[] = [];
  for (const beat of [...byBeat.keys()].sort((a, b) => a - b)) {
    const time = median(byBeat.get(beat)!);
    if (!known.length || time > known.at(-1)!.time) known.push({ beat, time });
  }
  const times = new Float64Array(beatPositions.length);
  if (known.length < 2) {
    const start = known[0]?.time ?? 0;
    times.forEach((_, beat) => { times[beat] = start + (beat - (known[0]?.beat ?? 0)) * 0.5; });
  } else {
    const first = known[0], second = known[1];
    const leading = (second.time - first.time) / (second.beat - first.beat);
    const tail = known.slice(-4);
    const trailing = (tail.at(-1)!.time - tail[0].time) / Math.max(1, tail.at(-1)!.beat - tail[0].beat);
    let segment = 0;
    for (let beat = 0; beat < beatPositions.length; beat++) {
      while (segment < known.length - 2 && known[segment + 1].beat <= beat) segment++;
      const before = known[segment], after = known[segment + 1];
      if (beat < first.beat) times[beat] = first.time - (first.beat - beat) * leading;
      else if (beat > known.at(-1)!.beat) times[beat] = known.at(-1)!.time + (beat - known.at(-1)!.beat) * trailing;
      else times[beat] = before.time + (after.time - before.time) * (beat - before.beat) / (after.beat - before.beat);
    }
  }
  return clockFrom(beatPositions.map((position, beat) => ({ position, time: times[beat] })));
}

/** A clock from stored beats, linear between them and extended past the ends. */
export function clockFrom(beats: readonly { position: number; time: number }[]): BeatClock {
  const last = beats.length - 1;
  const segmentAt = (value: number, key: 'position' | 'time') => {
    let low = 0, high = last;
    while (low < high - 1) {
      const middle = (low + high) >> 1;
      if (beats[middle][key] <= value) low = middle; else high = middle;
    }
    return low;
  };
  const between = (value: number, from: 'position' | 'time', to: 'position' | 'time') => {
    if (beats.length < 2) return value;
    const index = value < beats[0][from] ? 0 : value >= beats[last][from] ? last - 1 : segmentAt(value, from);
    const a = beats[index], b = beats[index + 1];
    const span = b[from] - a[from];
    return span > 0 ? a[to] + (b[to] - a[to]) * (value - a[from]) / span : a[to];
  };
  return {
    beats,
    timeAt: position => between(position, 'position', 'time'),
    positionAt: time => between(time, 'time', 'position')
  };
}
