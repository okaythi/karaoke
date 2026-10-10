// The player's calls to its own API. Each resolves to null when the request fails; none throws.

export type VoteAction = 'like' | 'dislike';

export interface VoteState {
  liked: boolean;
  disliked: boolean;
  totalLikes: number;
  totalDislikes: number;
}

async function readJson<T>(request: Promise<Response>): Promise<T | null> {
  try {
    const response = await request;
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const listener = (krId: string | null): Record<string, string> => (krId ? { kr_id: krId } : {});

export function fetchVotes(videoKey: string, krId: string | null): Promise<VoteState | null> {
  return readJson(fetch(`/api/vote?${new URLSearchParams({ file_name: videoKey, ...listener(krId) })}`));
}

export function sendVote(videoKey: string, action: VoteAction, krId: string | null): Promise<VoteState | null> {
  return readJson(post('/api/vote', { file_name: videoKey, action, ...listener(krId) }));
}

export async function reportView(videoKey: string, krId: string | null): Promise<void> {
  await readJson(post('/api/vote', { file_name: videoKey, count_view: true, ...listener(krId) }));
}

export async function requestKrId(clientHash: string): Promise<string | null> {
  return (await readJson<{ krId?: string }>(post('/api/fingerprint', { clientHash })))?.krId ?? null;
}
