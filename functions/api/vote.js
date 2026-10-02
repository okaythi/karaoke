// ─── Shared ───────────────────────────────────────────────────────────────────

const KR_ID_PATTERN = /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_FILE_NAME_LENGTH = 512;

/** Vote state is per listener, so no response may be cached on the way. */
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isFileName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FILE_NAME_LENGTH;
}

function totals(row) {
  return {
    totalLikes:    row?.likes    ?? 0,
    totalDislikes: row?.dislikes ?? 0,
    views:         row?.views    ?? 0,
  };
}

const SELECT_TOTALS = 'SELECT likes, dislikes, views FROM song_votes WHERE file_name = ?';
const ENSURE_TOTALS = 'INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 0) ON CONFLICT(file_name) DO NOTHING';

// ─── Identity Resolution ──────────────────────────────────────────────────────

/** The token inside the legacy session cookie. Only the token is used: it is checked against `users`. */
function sessionCookieToken(request) {
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sudothy_session=([^;]+)/);
  if (!match) return null;
  try {
    const token = JSON.parse(decodeURIComponent(match[1]))?.token;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the caller's identity.
 * Priority: 1) logged-in user, by a token the users table confirms  2) kr_id (anonymous fingerprint)
 * Returns { username, krId } — at most one is set. With `requireKnownKrId`,
 * only kr-IDs issued by /api/fingerprint count, so votes cannot be cast
 * under invented IDs.
 */
async function resolveIdentity(request, env, bodyToken, bodyKrId, { requireKnownKrId = false } = {}) {
  const authHeader = request.headers.get('Authorization');
  const tokens = [
    bodyToken || (authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null),
    sessionCookieToken(request),
  ].filter(token => typeof token === 'string' && token);

  for (const token of tokens) {
    try {
      const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(token).first();
      if (user?.username) return { username: user.username, krId: null };
    } catch {}
  }

  if (typeof bodyKrId === 'string' && KR_ID_PATTERN.test(bodyKrId)) {
    if (!requireKnownKrId) return { username: null, krId: bodyKrId };
    try {
      const known = await env.DB.prepare('SELECT 1 FROM anonymous_users WHERE kr_id = ?').bind(bodyKrId).first();
      if (known) return { username: null, krId: bodyKrId };
    } catch {}
  }

  return { username: null, krId: null };
}

/** Statement selecting this voter's row; the column name is fixed, never user input. */
function voterClause({ username }) {
  return username ? 'username = ?' : 'kr_id = ?';
}

// ─── GET /api/vote ────────────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const fileName = url.searchParams.get('file_name');

  if (!isFileName(fileName)) {
    return json({ error: 'Missing file_name' }, 400);
  }

  if (!env.DB) {
    return json({ liked: false, disliked: false, totalLikes: 0, totalDislikes: 0, views: 0 });
  }

  const identity = await resolveIdentity(request, env, url.searchParams.get('token'), url.searchParams.get('kr_id'));
  const voter = identity.username || identity.krId;

  try {
    // One round trip for the song totals and this listener's own vote.
    const statements = [env.DB.prepare(SELECT_TOTALS).bind(fileName)];
    if (voter) {
      statements.push(env.DB
        .prepare(`SELECT action FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
        .bind(voter, fileName));
    }
    const [totalsResult, voteResult] = await env.DB.batch(statements);
    const action = voteResult?.results?.[0]?.action;

    return json({
      liked:    action === 'like',
      disliked: action === 'dislike',
      ...totals(totalsResult.results?.[0]),
    });
  } catch (error) {
    console.error('[vote] read failed:', error);
    return json({ error: 'Vote lookup failed' }, 500);
  }
}

// ─── POST /api/vote ───────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ error: 'Database not bound' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { file_name, action, token: bodyToken, kr_id: bodyKrId, count_view: countView } = body ?? {};

  // ── View increment (5.47s threshold enforced client-side) ──────────────────
  if (countView === true && file_name) {
    if (!isFileName(file_name)) return json({ error: 'Invalid file_name' }, 400);
    try {
      const statements = [env.DB
        .prepare('INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 1) ON CONFLICT(file_name) DO UPDATE SET views = views + 1')
        .bind(file_name)];
      // Also increment the anonymous user's personal view counter
      if (typeof bodyKrId === 'string' && KR_ID_PATTERN.test(bodyKrId)) {
        statements.push(env.DB
          .prepare('UPDATE anonymous_users SET views = views + 1, last_seen = CURRENT_TIMESTAMP WHERE kr_id = ?')
          .bind(bodyKrId));
      }
      await env.DB.batch(statements);
    } catch (error) {
      console.error('[vote] view count failed:', error);
    }
    return json({ ok: true });
  }

  // ── Vote ───────────────────────────────────────────────────────────────────
  if (!file_name || !action) {
    return json({ error: 'Missing params' }, 400);
  }
  if (!isFileName(file_name)) {
    return json({ error: 'Invalid file_name' }, 400);
  }
  if (action !== 'like' && action !== 'dislike') {
    return json({ error: 'Invalid action' }, 400);
  }

  const identity = await resolveIdentity(request, env, bodyToken, bodyKrId, { requireKnownKrId: true });
  const { username, krId } = identity;

  if (!username && !krId) {
    return json({ error: 'Unidentified' }, 401);
  }

  try {
    const voter = username || krId;
    const previous = await env.DB
      .prepare(`SELECT action FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
      .bind(voter, file_name)
      .first();
    const prevAction = previous?.action ?? null;

    let likeDelta = 0;
    let dislikeDelta = 0;
    const statements = [];

    if (prevAction === action) {
      // Toggle off
      statements.push(env.DB
        .prepare(`DELETE FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
        .bind(voter, file_name));
      if (action === 'like')    likeDelta = -1;
      if (action === 'dislike') dislikeDelta = -1;
    } else {
      // Upsert vote
      statements.push(username
        ? env.DB
          .prepare('INSERT OR REPLACE INTO user_song_votes (username, file_name, action, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
          .bind(username, file_name, action)
        : env.DB
          .prepare('INSERT INTO user_song_votes (username, file_name, action, timestamp, kr_id) VALUES (NULL, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(kr_id, file_name) WHERE kr_id IS NOT NULL DO UPDATE SET action = excluded.action, timestamp = excluded.timestamp')
          .bind(file_name, action, krId));
      if (action === 'like') {
        likeDelta = 1;
        if (prevAction === 'dislike') dislikeDelta = -1;
      } else {
        dislikeDelta = 1;
        if (prevAction === 'like') likeDelta = -1;
      }
    }

    // Ensure the song_votes row exists, then apply deltas. The batch runs as
    // one transaction, so the listener's vote and the totals never disagree.
    statements.push(env.DB.prepare(ENSURE_TOTALS).bind(file_name));
    if (likeDelta !== 0 || dislikeDelta !== 0) {
      statements.push(env.DB
        .prepare('UPDATE song_votes SET likes = MAX(0, likes + ?), dislikes = MAX(0, dislikes + ?) WHERE file_name = ?')
        .bind(likeDelta, dislikeDelta, file_name));
    }
    statements.push(env.DB.prepare(SELECT_TOTALS).bind(file_name));

    const results = await env.DB.batch(statements);

    return json({
      liked:    prevAction !== action && action === 'like',
      disliked: prevAction !== action && action === 'dislike',
      ...totals(results.at(-1)?.results?.[0]),
    });
  } catch (error) {
    console.error('[vote] write failed:', error);
    return json({ error: 'Vote failed' }, 500);
  }
}
