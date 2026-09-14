// ─── Type-Level Validation ────────────────────────────────────────────────────

type UpperAlphanumChar =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L'
  | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X'
  | 'Y' | 'Z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** Validates exactly N upper-alphanumeric characters */
type ExactChars<S extends string, N extends number, Acc extends string = ''> =
  Acc extends { length: N } ? (S extends '' ? Acc : never)
  : S extends `${UpperAlphanumChar}${infer Rest}`
    ? S extends `${infer C}${Rest}`
      ? ExactChars<Rest, N, `${Acc}${C}`>
      : never
    : never;

/** Compile-time validation: must match /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/ */
export type ValidateKrId<T extends string> =
  T extends `kr-${infer A}-${infer B}`
    ? ExactChars<A, 4> extends never ? never
    : ExactChars<B, 4> extends never ? never
    : T
    : never;

/** Branded ID type — prevents raw strings from being used as UserId */
export type UserId<T extends string = string> = { readonly id: T };

export function createUserId<T extends string>(id: ValidateKrId<T>): UserId<T> {
  return { id } as UserId<T>;
}

// ─── Runtime Validation ───────────────────────────────────────────────────────

export const KR_ID_REGEX = /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function isValidKrId(id: string): boolean {
  return KR_ID_REGEX.test(id);
}

// ─── ID Generation from hash bytes ───────────────────────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Deterministically encodes 8 bytes into kr-XXXX-XXXX format.
 * Each character encodes 6 bits from the hash (36^8 ≈ 2.8 trillion combinations).
 */
export function bytesToKrId(bytes: Uint8Array): string {
  let a = '';
  let b = '';
  for (let i = 0; i < 4; i++) {
    a += CHARS[bytes[i]     % 36];
    b += CHARS[bytes[i + 4] % 36];
  }
  return `kr-${a}-${b}`;
}
