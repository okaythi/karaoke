import { isValidKrId } from '../../src/fingerprint/kr-id';
import { cookieValues, json, type Context } from '../../src/server/http';

const MAX_FILE_NAME_LENGTH = 512;

type VoteAction = 'like' | 'dislike';
interface Identity { username: string | null; krId: string | null }
interface TotalsRow { likes?: number; dislikes?: number; views?: number }

function isFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FILE_NAME_LENGTH;
}

function totals(row?: TotalsRow | null) {
  return {
    totalLikes: row?.likes ?? 0,
    totalDislikes: row?.dislikes ?? 0,
    views: row?.views ?? 0
  };
}

const SELECT_TOTALS = 'SELECT likes, dislikes, views FROM song_votes WHERE file_name = ?';
const ENSURE_TOTALS = 'INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 0) ON CONFLICT(file_name) DO NOTHING';

/** The token inside the legacy session cookie. Only the token is used: it is checked against `users`. */
function sessionCookieToken(request: Request): string | null {
  const [value] = cookieValues(request, 'sudothy_session');
  if (!value) return null;
  try {
    const token = JSON.parse(decodeURIComponent(value))?.token;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the caller: a signed-in user (a token the users table confirms)
 * wins over an anonymous kr-ID, and at most one of the two is set. With
 * `requireKnownKrId`, only kr-IDs issued by /api/fingerprint count, so votes
 * cannot be cast under invented IDs. Tokens are read from the request body,
 * the Authorization header or the session cookie, never from the URL.
 */
async function resolveIdentity(request: Request, db: D1Database, bodyToken: unknown, krId: unknown, { requireKnownKrId = false } = {}): Promise<Identity> {
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const tokens = [bodyToken || bearer, sessionCookieToken(request)].filter((token): token is string => typeof token === 'string' && token !== '');

  for (const token of tokens) {
    try {
      const user = await db.prepare('SELECT username FROM users WHERE id = ?').bind(token).first<{ username: string }>();
      if (user?.username) return { username: user.username, krId: null };
    } catch (error) {
      console.warn('[vote] user lookup failed:', error);
    }
  }

  if (isValidKrId(krId)) {
    if (!requireKnownKrId) return { username: null, krId };
    try {
      if (await db.prepare('SELECT 1 FROM anonymous_users WHERE kr_id = ?').bind(krId).first()) return { username: null, krId };
    } catch (error) {
      console.warn('[vote] kr-ID lookup failed:', error);
    }
  }

  return { username: null, krId: null };
}

/** Clause selecting this voter's row; the column name is fixed, never user input. */
function voterClause({ username }: Identity): string {
  return username ? 'username = ?' : 'kr_id = ?';
}

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  const fileName = url.searchParams.get('file_name');

  if (!isFileName(fileName)) {
    return json({ error: 'Missing file_name' }, 400);
  }
  if (!env.DB) {
    return json({ liked: false, disliked: false, ...totals() });
  }

  const identity = await resolveIdentity(request, env.DB, null, url.searchParams.get('kr_id'));
  const voter = identity.username || identity.krId;

  try {
    // One round trip for the song totals and this listener's own vote.
    const statements = [env.DB.prepare(SELECT_TOTALS).bind(fileName)];
    if (voter) {
      statements.push(env.DB
        .prepare(`SELECT action FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
        .bind(voter, fileName));
    }
    const [totalsResult, voteResult] = await env.DB.batch<TotalsRow & { action?: VoteAction }>(statements);
    const action = voteResult?.results?.[0]?.action;

    return json({
      liked: action === 'like',
      disliked: action === 'dislike',
      ...totals(totalsResult.results?.[0])
    });
  } catch (error) {
    console.error('[vote] read failed:', error);
    return json({ error: 'Vote lookup failed' }, 500);
  }
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  if (!env.DB) {
    return json({ error: 'Database not bound' }, 503);
  }

  let body: { file_name?: unknown; action?: unknown; token?: unknown; kr_id?: unknown; count_view?: unknown };
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { file_name: fileName, action, token: bodyToken, kr_id: bodyKrId, count_view: countView } = body;

  // A view is reported once the listener has genuinely played the song; the threshold is the client's.
  if (countView === true && fileName) {
    if (!isFileName(fileName)) return json({ error: 'Invalid file_name' }, 400);
    try {
      const statements = [env.DB
        .prepare('INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 1) ON CONFLICT(file_name) DO UPDATE SET views = views + 1')
        .bind(fileName)];
      if (isValidKrId(bodyKrId)) {
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

  if (!fileName || !action) {
    return json({ error: 'Missing params' }, 400);
  }
  if (!isFileName(fileName)) {
    return json({ error: 'Invalid file_name' }, 400);
  }
  if (action !== 'like' && action !== 'dislike') {
    return json({ error: 'Invalid action' }, 400);
  }

  const identity = await resolveIdentity(request, env.DB, bodyToken, bodyKrId, { requireKnownKrId: true });
  const { username, krId } = identity;
  const voter = username || krId;
  if (!voter) {
    return json({ error: 'Unidentified' }, 401);
  }

  try {
    const previous = await env.DB
      .prepare(`SELECT action FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
      .bind(voter, fileName)
      .first<{ action: VoteAction }>();
    const prevAction = previous?.action ?? null;
    const toggledOff = prevAction === action;

    let likeDelta = 0;
    let dislikeDelta = 0;
    const statements = [];

    if (toggledOff) {
      statements.push(env.DB
        .prepare(`DELETE FROM user_song_votes WHERE ${voterClause(identity)} AND file_name = ?`)
        .bind(voter, fileName));
      if (action === 'like') likeDelta = -1;
      else dislikeDelta = -1;
    } else {
      statements.push(username
        ? env.DB
          .prepare('INSERT OR REPLACE INTO user_song_votes (username, file_name, action, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
          .bind(username, fileName, action)
        : env.DB
          .prepare('INSERT INTO user_song_votes (username, file_name, action, timestamp, kr_id) VALUES (NULL, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(kr_id, file_name) WHERE kr_id IS NOT NULL DO UPDATE SET action = excluded.action, timestamp = excluded.timestamp')
          .bind(fileName, action, krId));
      if (action === 'like') {
        likeDelta = 1;
        if (prevAction === 'dislike') dislikeDelta = -1;
      } else {
        dislikeDelta = 1;
        if (prevAction === 'like') likeDelta = -1;
      }
    }

    // The batch runs as one transaction, so the listener's vote and the totals never disagree.
    statements.push(env.DB.prepare(ENSURE_TOTALS).bind(fileName));
    if (likeDelta !== 0 || dislikeDelta !== 0) {
      statements.push(env.DB
        .prepare('UPDATE song_votes SET likes = MAX(0, likes + ?), dislikes = MAX(0, dislikes + ?) WHERE file_name = ?')
        .bind(likeDelta, dislikeDelta, fileName));
    }
    statements.push(env.DB.prepare(SELECT_TOTALS).bind(fileName));

    const results = await env.DB.batch<TotalsRow>(statements);

    return json({
      liked: !toggledOff && action === 'like',
      disliked: !toggledOff && action === 'dislike',
      ...totals(results.at(-1)?.results?.[0])
    });
  } catch (error) {
    console.error('[vote] write failed:', error);
    return json({ error: 'Vote failed' }, 500);
  }
}
