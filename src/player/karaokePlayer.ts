import { loadCatalog, loadLyrics, localCatalog } from '../catalog/catalog';
import { hasSongScore, loadSongScore } from '../notation/songs';
import { prepareProtectedPlayback } from '../security/playback';
import { isProtectedSong } from '../security/protectedSong.js';
import type { SongCatalogItem } from '../types/karaoke';
import { createAudioMix } from './audioMix';
import { byId } from './dom';
import { createIdentity } from './identity';
import { createLibrary } from './library';
import { createMediaSession } from './mediaSession';
import { adjacentSong, buildSongHistoryUrl, seekWhenReady } from './navigation';
import { createNowPlaying } from './nowPlaying';
import { initShareButton } from './share';
import { createStage, type LoadedScore } from './stage';
import { createTransport } from './transport';
import { createViewCounter } from './viewCounter';
import { createVotes } from './votes';

/** A protected song's playback grant is renewed this often while it plays. */
const GRANT_RENEWAL_MS = 60_000;
/** The J and L keys step this far, in seconds. */
const SEEK_STEP = 2;
/** In fullscreen, the pointer and transport fade after this long without movement. */
const FULLSCREEN_IDLE_MS = 2800;

const hasScore = (song: SongCatalogItem): boolean => hasSongScore(song.id);
const playable = (catalog: SongCatalogItem[]): SongCatalogItem[] =>
  catalog.filter(song => song.isOnR2 && (song.hasLyrics || hasScore(song)));

/** The arrangement and its view, fetched together; the engine is a separate chunk only scored songs need. */
async function loadScore(songId: string): Promise<LoadedScore | null> {
  const [bundle, { createScoreView }] = await Promise.all([loadSongScore(songId), import('../notation/view/theater')]);
  return bundle ? { bundle, createView: createScoreView } : null;
}

export interface TheaterOptions {
  /** Brings the song list into view; while its drawer is closed the search box cannot take focus. */
  showLibrary(): void;
}

/** Wires the theater page: picking a song loads it onto the stage and starts it. */
export function initKaraokeTheater({ showLibrary }: TheaterOptions): void {
  const video = byId<HTMLVideoElement>('theater-video');
  const stageElement = document.querySelector<HTMLElement>('.theater-stage')!;
  const identity = createIdentity();
  const stage = createStage(video);
  const audioMix = createAudioMix(video);
  const nowPlaying = createNowPlaying();
  const votes = createVotes(identity);
  const views = createViewCounter(video, identity);
  const transport = createTransport(video, () => void togglePlay());
  const library = createLibrary(song => void selectSong(song, { syncUrl: true }));

  let activeSong: SongCatalogItem | null = null;
  // Aborted when another song is picked, so slower work from the earlier pick can tell it is stale.
  let selection = new AbortController();
  initShareButton(() => activeSong);

  const stepTrack = (direction: -1 | 1) => {
    const next = adjacentSong(library.visibleSongs(), activeSong?.id ?? null, direction);
    if (next) void selectSong(next, { syncUrl: true });
  };

  const mediaSession = createMediaSession(video, {
    onPlay: () => void togglePlay(),
    onPause: () => video.pause(),
    onSeekBackward: () => { video.currentTime = Math.max(0, video.currentTime - SEEK_STEP); },
    onSeekForward: () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_STEP); },
    onPreviousTrack: () => stepTrack(-1),
    onNextTrack: () => stepTrack(1)
  });

  function play(): void {
    video.play().then(() => transport.showPlaying(true)).catch(error => {
      console.warn('Playback was prevented or failed:', error);
      transport.showPlaying(false);
    });
  }

  async function selectSong(
    song: SongCatalogItem,
    options: { syncUrl?: boolean; startAt?: number } = {}
  ): Promise<void> {
    if (activeSong?.id === song.id && !video.paused && !options.startAt) return;
    selection.abort();
    selection = new AbortController();
    const { signal } = selection;
    activeSong = song;

    if (options.syncUrl) {
      const nextUrl = buildSongHistoryUrl(location.search, location.pathname, song);
      history.replaceState(null, '', nextUrl);
    }

    library.setActive(song.id);
    nowPlaying.show(song);
    mediaSession.show(song);
    views.watch(song.videoFile);
    stage.clear();
    audioMix.setStem(song.instrumentalUrl ?? null);

    // A protected song is verified before its media URL is assigned: no bytes and no autoplay before approval.
    const isProtected = isProtectedSong(song.id);
    stage.showStatus(isProtected ? 'Preparing playback' : '', isProtected);
    if (isProtected) transport.hideCenterPlay();
    video.pause();
    video.removeAttribute('src');
    video.load();

    // Lyrics and score load while the grant is checked; their failures are handled where they are awaited.
    const lyrics = song.scoreOnly ? null : loadLyrics(song.id, { live: song.hasLiveLyrics, signal });
    const score = hasScore(song) ? loadScore(song.id).catch(() => 'failed' as const) : null;

    try {
      await prepareProtectedPlayback(song.id);
    } catch (error) {
      if (signal.aborted) return;
      stage.showStatus(error instanceof Error ? error.message : 'Protected playback is unavailable.');
      transport.showPlaying(false);
      return;
    }
    if (signal.aborted) return;
    stage.showStatus('');
    video.src = song.videoUrl;
    video.load();
    video.currentTime = 0;
    if (options.startAt && options.startAt > 0) {
      seekWhenReady(video, options.startAt, signal);
    }
    transport.reset();

    const [lyricFile, loadedScore] = await Promise.all([lyrics, score]);
    if (signal.aborted) return;
    stage.mount({
      songId: song.id,
      title: song.title,
      verses: lyricFile?.lyricsData ?? [],
      parts: lyricFile?.parts,
      globalOffset: song.globalOffset || 0,
      score: loadedScore === 'failed' ? null : loadedScore
    });
    if (loadedScore === 'failed') stage.showStatus('The arrangement could not be loaded. Select the song again to retry.');

    play();
    votes.show(song.videoFile);
  }

  async function togglePlay(): Promise<void> {
    if (!video.paused) {
      video.pause();
      return;
    }
    if (activeSong && !video.getAttribute('src')) {
      await selectSong(activeSong);
      return;
    }
    const { signal } = selection;
    if (activeSong && isProtectedSong(activeSong.id)) {
      try {
        await prepareProtectedPlayback(activeSong.id);
      } catch {
        transport.showPlaying(false);
        return;
      }
      if (signal.aborted) return;
    }
    play();
  }

  setInterval(() => {
    if (!activeSong || !isProtectedSong(activeSong.id) || video.paused || document.hidden) return;
    prepareProtectedPlayback(activeSong.id).catch(() => {
      video.pause();
      transport.showPlaying(false);
    });
  }, GRANT_RENEWAL_MS);

  const fullscreenButton = byId<HTMLButtonElement>('deck-fullscreen-btn');
  const toggleFullscreen = () => {
    const target = document.fullscreenElement ? document.exitFullscreen() : stageElement.requestFullscreen();
    target.catch(console.warn);
  };
  fullscreenButton.addEventListener('click', toggleFullscreen);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const wakeFullscreenControls = () => {
    clearTimeout(idleTimer);
    stageElement.classList.remove('fullscreen-idle');
    if (!document.fullscreenElement || video.paused) return;
    idleTimer = setTimeout(() => {
      if (document.fullscreenElement && !video.paused) {
        stageElement.classList.add('fullscreen-idle');
      }
    }, FULLSCREEN_IDLE_MS);
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) {
    stageElement.addEventListener(type, wakeFullscreenControls, { passive: true });
  }
  document.addEventListener('fullscreenchange', wakeFullscreenControls);
  video.addEventListener('play', wakeFullscreenControls);
  video.addEventListener('pause', wakeFullscreenControls);

  byId('deck-prev-btn').addEventListener('click', () => stepTrack(-1));
  byId('deck-next-btn').addEventListener('click', () => stepTrack(1));

  byId('deck-shuffle-btn').addEventListener('click', () => {
    const others = library.visibleSongs().filter(song => song.id !== activeSong?.id);
    if (others.length > 0) void selectSong(others[Math.floor(Math.random() * others.length)], { syncUrl: true });
  });

  // Automatically advance to the next visible song when a track finishes playing.
  video.addEventListener('ended', () => {
    const songs = library.visibleSongs();
    if (songs.length <= 1) return;
    stepTrack(1);
  });

  const shortcuts: Record<string, () => void> = {
    Space: () => void togglePlay(),
    KeyK: () => void togglePlay(),
    KeyJ: () => { video.currentTime = Math.max(0, video.currentTime - SEEK_STEP); },
    KeyL: () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_STEP); },
    KeyM: audioMix.toggleMute,
    KeyV: audioMix.toggleVocals,
    KeyF: toggleFullscreen
  };
  const searchLibrary = () => {
    showLibrary();
    library.focusSearch();
  };
  window.addEventListener('keydown', event => {
    // Browser shortcuts such as Ctrl+F and Ctrl+L keep their meaning.
    if (library.ownsKey(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.shiftKey) {
      if (event.code === 'KeyN') { event.preventDefault(); stepTrack(1); }
      else if (event.code === 'KeyP') { event.preventDefault(); stepTrack(-1); }
      return;
    }
    const action = event.key === '/' ? searchLibrary : shortcuts[event.code];
    if (!action) return;
    event.preventDefault();
    action();
  });

  // The bundled manifest fills the list and starts the first song at once;
  // the R2 listing then corrects it: missing videos go, uploaded ones appear.
  const params = new URLSearchParams(location.search);
  const linkedId = params.get('song');
  const startAt = parseFloat(params.get('t') || params.get('time') || '0');
  const linkedIn = (songs: SongCatalogItem[]) =>
    linkedId ? songs.find(song => song.id === linkedId || song.shareCode === linkedId) : undefined;

  const open = (songs: SongCatalogItem[]) => {
    const linked = linkedIn(songs);
    library.open(linked);
    const first = linked ?? library.visibleSongs()[0];
    if (!first) return;
    void selectSong(first, {
      syncUrl: !!linked,
      startAt: startAt > 0 ? startAt : undefined
    });
  };

  const reconcile = (songs: SongCatalogItem[]) => {
    library.setCatalog(songs, hasScore);
    const current = songs.find(song => song.id === activeSong?.id);
    if (!current || !activeSong) return;
    // Only the listing knows whether a stem with the conventional name exists.
    if ((current.instrumentalUrl ?? null) !== (activeSong.instrumentalUrl ?? null)) audioMix.setStem(current.instrumentalUrl ?? null);
    activeSong = current;
  };

  const local = playable(localCatalog());
  const listed = loadCatalog().then(playable);
  library.setCatalog(local, hasScore);
  if (linkedId && !linkedIn(local)) {
    // The link may name a song only R2 knows about, so the listing is needed before anything starts.
    void listed.then(songs => {
      library.setCatalog(songs, hasScore);
      open(songs);
    });
  } else {
    open(local);
    void listed.then(reconcile);
  }
}
