import { isValidKrId, bytesToKrId } from '../../src/fingerprint/kr-id.js';

// ─── Shared Utilities ─────────────────────────────────────────────────────────

/** Server-side SHA-256 using Web Crypto (available in Workers) */
async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a kr-ID from the first 8 bytes of a SHA-256 hash */
async function hashToKrId(combined: string): Promise<string> {
  return bytesToKrId((await sha256(combined)).slice(0, 8));
}

/** Identities are per visitor, so no response may be cached on the way. */
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

const MAX_ID_ATTEMPTS = 8;

// ─── POST /api/fingerprint ────────────────────────────────────────────────────

type Env = { DB: D1Database };

export async function onRequestPost({ request, env }: { request: Request & { cf?: Record<string, unknown> }; env: Env }) {
  if (!env.DB) {
    return json({ error: 'DB not bound' }, 503);
  }

  let clientHash: string;
  try {
    const body = await request.json() as { clientHash?: unknown };
    clientHash = typeof body?.clientHash === 'string' ? body.clientHash.trim() : '';
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (!/^[0-9a-f]{64}$/.test(clientHash)) {
    return json({ error: 'Invalid clientHash' }, 400);
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
  const serverHash  = toHex(await sha256(serverSig));

  // Combined hash: mix client-observed entropy with server-observed entropy
  const combinedHash = toHex(await sha256(clientHash + '::' + serverHash));

  try {
    // Returning visitor: refresh last_seen and read the ID in one statement.
    const existing = await env.DB
      .prepare('UPDATE anonymous_users SET last_seen = CURRENT_TIMESTAMP WHERE fp_hash = ? RETURNING kr_id')
      .bind(combinedHash)
      .first<{ kr_id: string }>();
    if (existing) {
      return json({ krId: existing.kr_id, isNew: false });
    }

    // New visitor. The insert is conditional, so two first requests racing
    // (e.g. two tabs) cannot fail on the unique fingerprint; the loser reads
    // the winner's ID. A taken kr-ID (very rare) is retried with a salted hash.
    let krId = await hashToKrId(combinedHash);
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      if (isValidKrId(krId)) {
        const inserted = await env.DB
          .prepare('INSERT INTO anonymous_users (kr_id, fp_hash) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING kr_id')
          .bind(krId, combinedHash)
          .first<{ kr_id: string }>();
        if (inserted) {
          return json({ krId: inserted.kr_id, isNew: true });
        }
        const registered = await env.DB
          .prepare('SELECT kr_id FROM anonymous_users WHERE fp_hash = ?')
          .bind(combinedHash)
          .first<{ kr_id: string }>();
        if (registered) {
          return json({ krId: registered.kr_id, isNew: false });
        }
      }
      krId = await hashToKrId(combinedHash + ':' + attempt);
    }
    return json({ error: 'Could not allocate an ID' }, 503);
  } catch (error) {
    console.error('[fingerprint] lookup failed:', error);
    return json({ error: 'Fingerprint lookup failed' }, 500);
  }
}
