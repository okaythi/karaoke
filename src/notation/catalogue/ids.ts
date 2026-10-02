import type { CATALOGUE } from './registry';

/** The ID of a catalogue entry, e.g. 'artic.staccato'. */
export type NotationId = (typeof CATALOGUE)[number]['id'];
