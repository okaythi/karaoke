// ─── Identity Resolution ──────────────────────────────────────────────────────

/**
 * Resolves the caller's identity.
 * Priority: 1) logged-in session/token  2) kr_id (anonymous fingerprint)
 * Returns { username, krId } — exactly one will be set.
 */
async function resolveIdentity(request, env, bodyToken, bodyKrId) {
  // 1. Logged-in user via Authorization header or session cookie
  if (env.DB) {
    const authHeader = request.headers.get('Authorization');
    const token = bodyToken || (authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null);
    if (token) {
      try {
        const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(token).first();
        if (user?.username) return { username: user.username, krId: null };
      } catch {}
    }

    const cookieStr = request.headers.get('cookie') || '';
    const match = cookieStr.match(/sudothy_session=([^;]+)/);
    if (match) {
      try {
        const session = JSON.parse(decodeURIComponent(match[1]));
        if (session?.user?.username) return { username: session.user.username, krId: null };
        if (session?.token) {
          const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(session.token).first();
          if (user?.username) return { username: user.username, krId: null };
        }
      } catch {}
    }
  }

  // 2. Anonymous fingerprint identity
  if (bodyKrId && /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(bodyKrId)) {
    return { username: null, krId: bodyKrId };
  }

  return { username: null, krId: null };
}

// ─── GET /api/vote ────────────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const fileName = url.searchParams.get('file_name');
  const queryKrId = url.searchParams.get('kr_id');

  if (!fileName) {
    return Response.json({ error: 'Missing file_name' }, { status: 400 });
  }

  if (!env.DB) {
    return Response.json({ liked: false, disliked: false, totalLikes: 0, totalDislikes: 0, views: 0 });
  }

  const { username, krId } = await resolveIdentity(
    request, env,
    url.searchParams.get('token'),
    queryKrId
  );

  // Fetch aggregate song counts
  const sysRes = await env.DB
    .prepare('SELECT likes, dislikes, views FROM song_votes WHERE file_name = ?')
    .bind(fileName)
    .first();

  let userLiked = false;
  let userDisliked = false;

  try {
    if (username) {
      const usrRes = await env.DB
        .prepare('SELECT action FROM user_song_votes WHERE username = ? AND file_name = ?')
        .bind(username, fileName)
        .first();
      if (usrRes?.action === 'like')    userLiked = true;
      if (usrRes?.action === 'dislike') userDisliked = true;
    } else if (krId) {
      const usrRes = await env.DB
        .prepare('SELECT action FROM user_song_votes WHERE kr_id = ? AND file_name = ?')
        .bind(krId, fileName)
        .first();
      if (usrRes?.action === 'like')    userLiked = true;
      if (usrRes?.action === 'dislike') userDisliked = true;
    }
  } catch {}

  return Response.json({
    liked:         userLiked,
    disliked:      userDisliked,
    totalLikes:    sysRes?.likes    ?? 0,
    totalDislikes: sysRes?.dislikes ?? 0,
    views:         sysRes?.views    ?? 0,
  });
}

// ─── POST /api/vote ───────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return Response.json({ error: 'Database not bound' }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { file_name, action, token: bodyToken, kr_id: bodyKrId, count_view: countView } = body;

  // ── View increment (5.47s threshold enforced client-side) ──────────────────
  if (countView === true && file_name) {
    try {
      await env.DB
        .prepare('INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 0) ON CONFLICT(file_name) DO NOTHING')
        .bind(file_name)
        .run();
      await env.DB
        .prepare('UPDATE song_votes SET views = views + 1 WHERE file_name = ?')
        .bind(file_name)
        .run();

      // Also increment the anonymous user's personal view counter
      const { krId: vidKrId } = await resolveIdentity(request, env, bodyToken, bodyKrId);
      if (vidKrId) {
        await env.DB
          .prepare('UPDATE anonymous_users SET views = views + 1, last_seen = CURRENT_TIMESTAMP WHERE kr_id = ?')
          .bind(vidKrId)
          .run();
      }
    } catch {}
    return Response.json({ ok: true });
  }

  // ── Vote ───────────────────────────────────────────────────────────────────
  if (!file_name || !action) {
    return Response.json({ error: 'Missing params' }, { status: 400 });
  }
  if (action !== 'like' && action !== 'dislike') {
    return Response.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { username, krId } = await resolveIdentity(request, env, bodyToken, bodyKrId);

  if (!username && !krId) {
    return Response.json({ error: 'Unidentified' }, { status: 401 });
  }

  try {
    // Fetch existing vote
    let prevAction = null;
    if (username) {
      const r = await env.DB
        .prepare('SELECT action FROM user_song_votes WHERE username = ? AND file_name = ?')
        .bind(username, file_name)
        .first();
      prevAction = r?.action ?? null;
    } else {
      const r = await env.DB
        .prepare('SELECT action FROM user_song_votes WHERE kr_id = ? AND file_name = ?')
        .bind(krId, file_name)
        .first();
      prevAction = r?.action ?? null;
    }

    let likeDelta = 0;
    let dislikeDelta = 0;

    if (prevAction === action) {
      // Toggle off
      if (username) {
        await env.DB
          .prepare('DELETE FROM user_song_votes WHERE username = ? AND file_name = ?')
          .bind(username, file_name)
          .run();
      } else {
        await env.DB
          .prepare('DELETE FROM user_song_votes WHERE kr_id = ? AND file_name = ?')
          .bind(krId, file_name)
          .run();
      }
      if (action === 'like')    likeDelta = -1;
      if (action === 'dislike') dislikeDelta = -1;
    } else {
      // Upsert vote
      if (username) {
        await env.DB
          .prepare('INSERT OR REPLACE INTO user_song_votes (username, file_name, action, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
          .bind(username, file_name, action)
          .run();
      } else {
        await env.DB
          .prepare('INSERT INTO user_song_votes (username, file_name, action, timestamp, kr_id) VALUES (NULL, ?, ?, CURRENT_TIMESTAMP, ?) ON CONFLICT(kr_id, file_name) WHERE kr_id IS NOT NULL DO UPDATE SET action = excluded.action, timestamp = excluded.timestamp')
          .bind(file_name, action, krId)
          .run();
      }
      if (action === 'like') {
        likeDelta = 1;
        if (prevAction === 'dislike') dislikeDelta = -1;
      } else {
        dislikeDelta = 1;
        if (prevAction === 'like') likeDelta = -1;
      }
    }

    // Ensure song_votes row exists, then apply deltas
    await env.DB
      .prepare('INSERT INTO song_votes (file_name, likes, dislikes, views) VALUES (?, 0, 0, 0) ON CONFLICT(file_name) DO NOTHING')
      .bind(file_name)
      .run();

    if (likeDelta !== 0 || dislikeDelta !== 0) {
      await env.DB
        .prepare('UPDATE song_votes SET likes = MAX(0, likes + ?), dislikes = MAX(0, dislikes + ?) WHERE file_name = ?')
        .bind(likeDelta, dislikeDelta, file_name)
        .run();
    }

    const sysRes = await env.DB
      .prepare('SELECT likes, dislikes, views FROM song_votes WHERE file_name = ?')
      .bind(file_name)
      .first();

    return Response.json({
      liked:         prevAction !== action && action === 'like',
      disliked:      prevAction !== action && action === 'dislike',
      totalLikes:    sysRes?.likes    ?? 0,
      totalDislikes: sysRes?.dislikes ?? 0,
      views:         sysRes?.views    ?? 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
