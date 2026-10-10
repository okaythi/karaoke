import { fetchVotes, sendVote, type VoteAction, type VoteState } from './api';
import { byId } from './dom';
import type { Identity } from './identity';

export interface Votes {
  /** Shows the totals, and this listener's own vote, for a song. */
  show(videoKey: string): void;
}

export function createVotes(identity: Identity): Votes {
  const likeButton = byId<HTMLButtonElement>('deck-like-btn');
  const dislikeButton = byId<HTMLButtonElement>('deck-dislike-btn');
  const likeCount = byId('deck-like-count');
  const dislikeCount = byId('deck-dislike-count');

  let videoKey: string | null = null;
  let vote: VoteAction | null = null;
  let sending = false;

  const showVote = () => {
    likeButton.classList.toggle('active', vote === 'like');
    dislikeButton.classList.toggle('active', vote === 'dislike');
  };

  const apply = (state: VoteState) => {
    vote = state.liked ? 'like' : state.disliked ? 'dislike' : null;
    likeCount.textContent = String(state.totalLikes || 0);
    dislikeCount.textContent = String(state.totalDislikes || 0);
    showVote();
  };

  // Answers for a song the listener has already skipped past must not overwrite the current one.
  const refresh = async (key: string, krId: string | null) => {
    const state = await fetchVotes(key, krId);
    if (state && videoKey === key) apply(state);
  };

  const show = (key: string) => {
    videoKey = key;
    const krId = identity.known();
    void refresh(key, krId);
    // The totals do not wait for the listener's ID; their own vote follows once it is known.
    if (!krId) void identity.eventually().then(id => { if (id && videoKey === key) void refresh(key, id); });
  };

  const cast = async (action: VoteAction) => {
    if (document.documentElement.classList.contains('music-visitor') || !videoKey || sending) return;
    const key = videoKey;
    const previous = vote;
    // Shown at once, and put back if the server does not accept it.
    vote = vote === action ? null : action;
    showVote();
    sending = true;
    try {
      const state = await sendVote(key, action, await identity.now());
      if (videoKey !== key) return;
      if (state) apply(state);
      else {
        vote = previous;
        showVote();
      }
    } finally {
      sending = false;
    }
  };

  likeButton.addEventListener('click', () => void cast('like'));
  dislikeButton.addEventListener('click', () => void cast('dislike'));

  return { show };
}
