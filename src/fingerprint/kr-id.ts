/** Anonymous listener IDs look like `kr-AB12-CD34`. */
export const KR_ID_PATTERN = /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function isValidKrId(id: unknown): id is string {
  return typeof id === 'string' && KR_ID_PATTERN.test(id);
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Encodes 8 hash bytes as a kr-ID, one base-36 character per byte (36^8 ≈ 2.8 trillion IDs). */
export function bytesToKrId(bytes: Uint8Array): string {
  let a = '';
  let b = '';
  for (let i = 0; i < 4; i++) {
    a += CHARS[bytes[i] % 36];
    b += CHARS[bytes[i + 4] % 36];
  }
  return `kr-${a}-${b}`;
}
