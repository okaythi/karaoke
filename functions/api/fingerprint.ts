import { isValidKrId, bytesToKrId } from '../../src/fingerprint/kr-id.js';

// ─── Shared Utilities ─────────────────────────────────────────────────────────

/** Server-side SHA-256 of a combined string using Web Crypto (available in Workers) */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a kr-ID from the first 8 bytes of a SHA-256 hash */
async function hashToKrId(combined: string): Promise<string> {
  const enc = new TextEncoder().encode(combined);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return bytesToKrId(new Uint8Array(buf).slice(0, 8));
}

// ─── POST /api/fingerprint ────────────────────────────────────────────────────

type Env = { DB: D1Database };

export async function onRequestPost({ request, env }: { request: Request & { cf?: Record<string, unknown> }; env: Env }) {
  if (!env.DB) {
    return Response.json({ error: 'DB not bound' }, { status: 503 });
  }

  let clientHash: string;
  try {
    const body = await request.json() as { clientHash?: string };
    clientHash = (body.clientHash ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!/^[0-9a-f]{64}$/.test(clientHash)) {
    return Response.json({ error: 'Invalid clientHash' }, { status: 400 });
  }

  // Merge with server-side network signals (no client trust required)
  const ip         = request.headers.get('CF-Connecting-IP') ?? '';
  const country    = request.headers.get('CF-IPCountry') ?? '';
  const ua         = request.headers.get('User-Agent') ?? '';
  const asn        = request.cf?.asn ?? '';
  const tlsCipher  = request.cf?.tlsCipher ?? '';
  const tlsVersion = request.cf?.tlsVersion ?? '';

  // Server fingerprint: IP + country + ASN + UA + TLS details
  const serverSig   = [ip, country, String(asn), ua, tlsCipher, tlsVersion].join('|');
  const serverHash  = await sha256Hex(serverSig);

  // Combined hash: mix client-observed entropy with server-observed entropy
  const combinedHash = await sha256Hex(clientHash + '::' + serverHash);

  // Look up existing user by combined fingerprint hash
  const existing = await env.DB
    .prepare('SELECT kr_id FROM anonymous_users WHERE fp_hash = ?')
    .bind(combinedHash)
    .first<{ kr_id: string }>();

  if (existing) {
    // Update last_seen
    await env.DB
      .prepare('UPDATE anonymous_users SET last_seen = CURRENT_TIMESTAMP WHERE fp_hash = ?')
      .bind(combinedHash)
      .run();
    return Response.json({ krId: existing.kr_id, isNew: false });
  }

  // Generate a new kr-ID; handle (very rare) hash collisions
  let krId = await hashToKrId(combinedHash);

  // Verify format and uniqueness — retry with salted hash if collision
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!isValidKrId(krId)) {
      krId = await hashToKrId(combinedHash + ':' + attempt);
      continue;
    }
    const collision = await env.DB
      .prepare('SELECT 1 FROM anonymous_users WHERE kr_id = ?')
      .bind(krId)
      .first();
    if (!collision) break;
    krId = await hashToKrId(combinedHash + ':' + attempt);
  }

  await env.DB
    .prepare('INSERT INTO anonymous_users (kr_id, fp_hash) VALUES (?, ?)')
    .bind(krId, combinedHash)
    .run();

  return Response.json({ krId, isNew: true });
}
