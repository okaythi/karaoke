import { prepareProtectedPlayback } from '../security/playback';
import { isProtectedSong } from '../security/protectedSong.js';
import type { SongCatalogItem, Verse } from '../types/karaoke';
import { loadCatalog, loadLyrics } from '../catalog/catalog';
import { fetchAlbumArt } from '../catalog/itunes';
import { sortSongs } from '../catalog/sorter';
import { createRenderEngine, type RenderEngineController } from '../renderer/renderEngine';
import { initDynamicBacklight } from '../renderer/backlight';
import { fuzzyFilterSongs } from './fuzzySearch';
import { LIBRARY_MODES, groupSongsByMode, otherMode, readStoredMode, resolveInitialMode, storeMode, type LibraryMode, type SongsByMode } from './libraryMode';
import { collectFingerprint } from '../fingerprint/fingerprint';
import { hasSongScore, loadSongScore } from '../notation/songs';
import type { ScoreViewController } from '../notation/view/theater';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string): string => String(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
const safeHref = (url: string): string => /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';


export interface PlayerElements {
  // Sidebar & Search Pill
  japaneseLogo: HTMLImageElement;
  sidebarList: HTMLElement;
  searchPillInput: HTMLInputElement;
  searchPillClear: HTMLButtonElement;
  /** Announces the list's size to screen readers; the visible counts sit in the mode switch. */
  songListStatus: HTMLElement;
  libraryMode: HTMLElement;
  libraryModeInputs: Record<LibraryMode, HTMLInputElement>;
  libraryModeCounts: Record<LibraryMode, HTMLElement>;

  // Center Theater Viewport
  videoContainer: HTMLElement;
  backlightContainer: HTMLElement;
  video: HTMLVideoElement;
  centerPlayBtn: HTMLButtonElement;
  lyricsContainer: HTMLElement;
  lineTop: HTMLElement;
  lineBottom: HTMLElement;

  // Active Song Header
  activeArtwork: HTMLImageElement;
  activeTitle: HTMLElement;
  activeTitleText?: HTMLElement;
  trackShareBtn?: HTMLButtonElement;
  activeArtist: HTMLElement;
  badgeTranslation: HTMLElement;
  badgeDialect: HTMLElement;
  supportContainer?: HTMLElement;
  supportBtn?: HTMLButtonElement;
  supportMenu?: HTMLElement;

  // Transport Deck
  btnPlayPause: HTMLButtonElement;
  playIcon: SVGElement;
  pauseIcon: SVGElement;
  timecodeDisplay?: HTMLElement;
  timeCurrent?: HTMLElement;
  timeDuration?: HTMLElement;
  progressBar: HTMLInputElement;
  volBtn: HTMLButtonElement;
  volIcon: HTMLElement;
  volInput: HTMLInputElement;
  btnVoice?: HTMLButtonElement;
  voiceIconOn?: SVGElement;
  voiceIconOff?: SVGElement;
  voicePointerPill?: HTMLElement;
  btnLike: HTMLButtonElement;
  btnDislike: HTMLButtonElement;
  likeCount: HTMLElement;
  dislikeCount: HTMLElement;
  btnShuffle: HTMLButtonElement;
  btnFullscreen: HTMLButtonElement;
}

const LIBRARY_COPY: Record<LibraryMode, { label: string; one: string; many: string; placeholder: string }> = {
  lyrics: { label: 'Lyrics', one: 'song', many: 'songs', placeholder: 'Search songs or artists...' },
  piano: { label: 'Piano', one: 'piece', many: 'pieces', placeholder: 'Search pieces or composers...' }
};

export function initKaraokeTheater(els: PlayerElements) {
  let allSongs: SongCatalogItem[] = [];
  let songsByMode: SongsByMode = { lyrics: [], piano: [] };
  let libraryMode: LibraryMode = 'lyrics';
  let filteredSongs: SongCatalogItem[] = [];
  let activeSong: SongCatalogItem | null = null;
  let renderController: RenderEngineController | null = null;
  let backlightController: { destroy: () => void } | null = null;
  let scoreController: ScoreViewController | null = null;
  let prevVolume = 0.7;
  let isDraggingScrubber = false;
  let isKaraokeMode = false;
  let instrumentalAudio: HTMLAudioElement | null = null;
  let japaneseLogoTimer: ReturnType<typeof setTimeout> | null = null;

  const updateVoiceButtonState = () => {
    if (!els.btnVoice) return;
    if (activeSong && activeSong.instrumentalUrl) {
      els.btnVoice.style.display = 'inline-flex';
      if (isKaraokeMode) {
        els.btnVoice.classList.add('karaoke-active');
        if (els.voiceIconOn) els.voiceIconOn.style.display = 'none';
        if (els.voiceIconOff) els.voiceIconOff.style.display = 'block';
        if (els.voicePointerPill) els.voicePointerPill.textContent = 'Restore Vocals';
      } else {
        els.btnVoice.classList.remove('karaoke-active');
        if (els.voiceIconOn) els.voiceIconOn.style.display = 'block';
        if (els.voiceIconOff) els.voiceIconOff.style.display = 'none';
        if (els.voicePointerPill) els.voicePointerPill.textContent = 'Remove Vocals';
      }
    } else {
      els.btnVoice.style.display = 'none';
      if (els.voicePointerPill) {
        els.voicePointerPill.classList.remove('visible');
        els.voicePointerPill.style.display = 'none';
      }
    }
  };

  const formatTime = (secs: number): string => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const updatePlayStateIcons = (isPlaying: boolean) => {
    els.playIcon.style.display = isPlaying ? 'none' : 'block';
    els.pauseIcon.style.display = isPlaying ? 'block' : 'none';
    if (isPlaying) {
      els.centerPlayBtn.classList.add('hidden');
    } else {
      els.centerPlayBtn.classList.remove('hidden');
    }
  };

  const togglePlay = async () => {
    if (els.video.paused) {
      if (activeSong && !els.video.getAttribute('src')) {
        await selectSong(activeSong);
        return;
      }
      const selection = selectionSerial;
      if (activeSong && isProtectedSong(activeSong.id)) {
        try { await prepareProtectedPlayback(activeSong.id); } catch { updatePlayStateIcons(false); return; }
        if (selection !== selectionSerial) return;
      }
      els.video.play().then(() => {
        updatePlayStateIcons(true);
      }).catch(err => {
        console.warn('Playback prevented or failed:', err);
        updatePlayStateIcons(false);
      });
    } else {
      els.video.pause();
    }
  };

  const CARD_PALETTES = [
    '#c5a14c', // Brass / Gold
    '#4b5366', // Slate / Steel
    '#a66887', // Rose / Berry
    '#8a6448', // Warm Caramel
    '#547770', // Sage / Muted Teal
    '#556d8a', // Denim Blue
    '#7d7367', // Taupe / Sand
    '#6e6284'  // Lavender / Purple
  ];

  // The list is empty: say why, and point at the other mode when the search matches there.
  const renderEmptyState = (query: string, matchesElsewhere: number) => {
    const copy = LIBRARY_COPY[libraryMode];
    const other = otherMode(libraryMode);
    const title = query ? `No ${copy.many} match “${escapeHtml(query)}”` : `No ${copy.many} yet`;
    const hint = !query
      ? ''
      : matchesElsewhere > 0
        ? `<button class="empty-search-switch" type="button">${matchesElsewhere} ${matchesElsewhere === 1 ? 'match' : 'matches'} in ${LIBRARY_COPY[other].label}</button>`
        : '<div class="empty-search-hint">Try a different title or artist</div>';
    els.sidebarList.innerHTML = `<div class="empty-search-state"><div class="empty-search-title">${title}</div>${hint}</div>`;
    els.sidebarList.querySelector('.empty-search-switch')?.addEventListener('click', () => {
      setLibraryMode(other);
      els.libraryModeInputs[other].focus();
    });
  };

  const renderSongCards = (songs: SongCatalogItem[]) => {
    els.sidebarList.innerHTML = '';

    songs.forEach((song, idx) => {
      const isSelected = activeSong?.id === song.id;
      const item = document.createElement('div');
      item.className = `song-card ${isSelected ? 'active' : ''}`;
      item.setAttribute('data-id', song.id);

      const queryArtist = song.itunesArtist || song.artist;
      const queryTrack = song.itunesTrack || song.title;

      let badgesHTML = '';
      if (song.hasTranslation) {
        badgesHTML += song.isDialect
          ? `<span class="badge badge-dialect" title="Dialect Vernacular">Dialect</span>`
          : `<span class="badge badge-trans" title="Localized Translation">SUB</span>`;
      }

      const trackNum = String(idx + 1).padStart(2, '0');
      const fallbackColor = encodeURIComponent(CARD_PALETTES[idx % CARD_PALETTES.length]);
      const placeholderSrc = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='${fallbackColor}'><rect width='44' height='44' rx='4'/></svg>`;

      item.innerHTML = `
        <span class="song-card-num">${trackNum}</span>
        <img class="song-card-art" src="${placeholderSrc}" alt="" />
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(song.title)}</div>
          <div class="song-card-artist">${escapeHtml(song.artist)}</div>
        </div>
        ${badgesHTML}
      `;

      // Fetch artwork for card
      const imgEl = item.querySelector('.song-card-art') as HTMLImageElement;
      fetchAlbumArt(queryArtist, queryTrack, imgEl, {
        country: song.itunesCountry,
        coverUrl: song.coverUrl
      });

      item.addEventListener('click', () => {
        selectSong(song);
      });

      els.sidebarList.appendChild(item);
    });
  };

  // Redraws the list for the current mode and search; the counts show what the search finds in each mode.
  const refreshSidebar = () => {
    const query = els.searchPillInput.value.trim();
    const matches = {
      lyrics: fuzzyFilterSongs(songsByMode.lyrics, query),
      piano: fuzzyFilterSongs(songsByMode.piano, query)
    };
    for (const mode of LIBRARY_MODES) els.libraryModeCounts[mode].textContent = String(matches[mode].length);

    filteredSongs = matches[libraryMode];
    const copy = LIBRARY_COPY[libraryMode];
    els.songListStatus.textContent = `${filteredSongs.length} ${filteredSongs.length === 1 ? copy.one : copy.many}`;
    if (filteredSongs.length === 0) renderEmptyState(query, matches[otherMode(libraryMode)].length);
    else renderSongCards(filteredSongs);
  };

  // Changes which list is shown. Playback carries on: the mode filters the library, not the stage.
  const setLibraryMode = (mode: LibraryMode, remember = true) => {
    libraryMode = mode;
    els.libraryModeInputs[mode].checked = true;
    els.searchPillInput.placeholder = LIBRARY_COPY[mode].placeholder;
    if (remember) storeMode(mode);
    els.sidebarList.scrollTop = 0;
    refreshSidebar();
  };

  for (const mode of LIBRARY_MODES) {
    els.libraryModeInputs[mode].addEventListener('change', () => setLibraryMode(mode));
  }

  // Incremented per selection so slower async work from an earlier pick can tell it is stale.
  let selectionSerial = 0;

  const selectSong = async (song: SongCatalogItem) => {
    if (activeSong?.id === song.id && !els.video.paused) return;

    const selection = ++selectionSerial;
    activeSong = song;
    // Explicit language covers romanized titles; script detection covers other Japanese tracks.
    const isJapaneseSong = song.language === 'ja' || song.itunesCountry?.toLowerCase() === 'jp' || /[\u3040-\u30ff\u3400-\u9fff]/u.test(`${song.title} ${song.artist}`);
    const logoFrame = els.japaneseLogo.parentElement;
    if (!isJapaneseSong) {
      if (japaneseLogoTimer) clearTimeout(japaneseLogoTimer);
      japaneseLogoTimer = null;
      logoFrame?.classList.remove('japanese-visible');
    } else if (!logoFrame?.classList.contains('japanese-visible') && !japaneseLogoTimer) {
      japaneseLogoTimer = setTimeout(() => {
        logoFrame?.classList.add('japanese-visible');
        japaneseLogoTimer = null;
      }, 5500);
    }
    resetViewState();

    // Highlight active card in sidebar
    els.sidebarList.querySelectorAll('.song-card').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-id') === song.id);
    });

    // Update active metadata in header
    if (els.activeTitleText) {
      els.activeTitleText.textContent = song.title;
    } else {
      els.activeTitle.textContent = song.title;
    }
    if (els.trackShareBtn) {
      els.trackShareBtn.classList.remove('copied');
    }
    els.activeArtist.textContent = song.artist;
    els.badgeTranslation.style.display = song.hasTranslation && !song.isDialect ? 'inline-flex' : 'none';
    els.badgeDialect.style.display = song.hasTranslation && song.isDialect ? 'inline-flex' : 'none';

    // Update Support the Artist button & menu
    if (els.supportContainer) {
      const hasSupport = !!song.support;
      els.supportContainer.style.display = hasSupport ? 'block' : 'none';
      if (els.supportMenu) {
        els.supportMenu.style.display = 'none';
        if (hasSupport) {
          const items = song.supportItems || (Array.isArray(song.support) ? song.support : [{
            itemName: 'Phatmark Collective',
            itemLink: 'https://phatmarkcollective.bandcamp.com/'
          }]);
          els.supportMenu.innerHTML = items.map(item => `
            <a href="${safeHref(item.itemLink)}" target="_blank" rel="noopener noreferrer" class="support-menu-item">
              <span>${escapeHtml(item.itemName)}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          `).join('');
        }
      }
    }

    fetchAlbumArt(
      song.itunesArtist || song.artist,
      song.itunesTrack || song.title,
      els.activeArtwork,
      {
        country: song.itunesCountry,
        coverUrl: song.coverUrl
      }
    );

    // Tear down existing render controllers
    if (renderController) {
      renderController.destroy();
      renderController = null;
    }
    if (backlightController) {
      backlightController.destroy();
      backlightController = null;
    }
    if (scoreController) {
      scoreController.destroy();
      scoreController = null;
    }
    const scoreContainer = document.getElementById('piano-score-container');
    if (scoreContainer) scoreContainer.hidden = true;
    els.lyricsContainer.hidden = true;

    // Reset instrumental stem playback
    if (instrumentalAudio) {
      instrumentalAudio.pause();
      instrumentalAudio.src = '';
      instrumentalAudio = null;
    }
    isKaraokeMode = false;
    els.video.muted = false;

    if (song.instrumentalUrl) {
      instrumentalAudio = new Audio(song.instrumentalUrl);
      instrumentalAudio.preload = 'auto';
      instrumentalAudio.volume = els.video.volume;
    }
    updateVoiceButtonState();

    const playbackStatus = document.getElementById('playback-status');
    const showPlaybackStatus = (message: string) => {
      if (playbackStatus) { playbackStatus.textContent = message; playbackStatus.hidden = !message; }
    };
    showPlaybackStatus(isProtectedSong(song.id) ? 'Preparing playback…' : '');
    // Verify before assigning a media URL: no bytes or autoplay before approval.
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.load();
    if (scoreContainer) scoreContainer.replaceChildren();
    try {
      await prepareProtectedPlayback(song.id);
    } catch (error) {
      if (selection !== selectionSerial) return;
      showPlaybackStatus(error instanceof Error ? error.message : 'Protected playback is unavailable.');
      updatePlayStateIcons(false);
      return;
    }
    if (selection !== selectionSerial) return;
    showPlaybackStatus('');
    els.video.src = song.videoUrl;
    els.video.load();
    els.video.currentTime = 0;
    els.progressBar.value = '0';
    els.progressBar.style.setProperty('--progress', '0%');
    if (els.timeCurrent) els.timeCurrent.textContent = '0:00';
    if (els.timeDuration) els.timeDuration.textContent = '0:00';
    if (els.timecodeDisplay) els.timecodeDisplay.textContent = '0:00 / 0:00';

    const lyricFile = song.scoreOnly ? null : await loadLyrics(song.id, { live: song.hasLiveLyrics });
    // A newer selection may have started while the lyrics loaded; it owns the stage now.
    if (selection !== selectionSerial) return;
    const verses: Verse[] = (lyricFile?.lyricsData || []).map(verse => {
      if (song.id !== 'the-fairly-odd-parents-theme-song' || verse.speaker) return verse;
      const line = verse.words.map(word => word.word).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (line === 'wands and wings') return { ...verse, speaker: 'Wanda' };
      if (line === 'floaty crowny things') return { ...verse, speaker: 'Cosmo' };
      return verse;
    });
    els.lyricsContainer.hidden = verses.length === 0;

    // Initialize 60 FPS Render Engine
    renderController = createRenderEngine({
      videoElement: els.video,
      containerElement: els.lyricsContainer,
      topLineElement: els.lineTop,
      bottomLineElement: els.lineBottom,
      lyricsData: verses,
      globalOffset: song.globalOffset || 0
    });

    if (hasSongScore(song.id) && scoreContainer) {
      try {
        const [bundle, { createScoreView }] = await Promise.all([loadSongScore(song.id), import('../notation/view/theater')]);
        if (selection !== selectionSerial) return;
        if (bundle) { scoreContainer.hidden = false; scoreController = createScoreView(els.video, scoreContainer, bundle); }
      } catch {
        if (selection !== selectionSerial) return;
        showPlaybackStatus('The arrangement could not be loaded. Select the song again to retry.');
      }
    }

    // Initialize Dynamic Backlight
    backlightController = initDynamicBacklight(els.video, els.backlightContainer);

    els.video.play().then(() => {
      updatePlayStateIcons(true);
    }).catch(e => {
      console.warn('Autoplay prevented on track select:', e);
      updatePlayStateIcons(false);
    });
    fetchVoteData(song.videoFile);
  };

  setInterval(() => {
    if (activeSong && isProtectedSong(activeSong.id) && !els.video.paused && !document.hidden) {
      void prepareProtectedPlayback(activeSong.id).catch(() => {
        els.video.pause();
        updatePlayStateIcons(false);
      });
    }
  }, 60_000);

  // ── Fingerprint Identity ───────────────────────────────────────────────────
  // Resolved lazily on first vote/view; cached for the lifetime of the page.
  let krIdPromise: Promise<string | null> | null = null;

  const getKrId = (): Promise<string | null> => {
    if (krIdPromise) return krIdPromise;
    krIdPromise = (async () => {
      // Check sessionStorage first — avoid re-fingerprinting on the same page load
      const cached = sessionStorage.getItem('_kr_id');
      if (cached && /^kr-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cached)) return cached;

      try {
        const clientHash = await collectFingerprint();
        const res = await fetch('/api/fingerprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientHash }),
        });
        if (!res.ok) return null;
        const { krId } = await res.json() as { krId: string };
        if (krId) sessionStorage.setItem('_kr_id', krId);
        return krId ?? null;
      } catch {
        return null;
      }
    })();
    return krIdPromise;
  };

  // ── Voting Integration (D1 Database) ──────────────────────────────────────
  let currentVote: 'like' | 'dislike' | null = null;
  let isVoting = false;

  const fetchVoteData = async (videoKey: string) => {
    try {
      const krId = await getKrId();
      const qs = new URLSearchParams({ file_name: videoKey });
      if (krId) qs.set('kr_id', krId);
      const res = await fetch(`/api/vote?${qs}`);
      // Counts for a song the listener already skipped past must not overwrite the current one.
      if (activeSong?.videoFile !== videoKey) return;
      if (res.ok) {
        const data = await res.json() as { liked: boolean; disliked: boolean; totalLikes: number; totalDislikes: number };
        currentVote = data.liked ? 'like' : data.disliked ? 'dislike' : null;
        els.likeCount.textContent = String(data.totalLikes || 0);
        els.dislikeCount.textContent = String(data.totalDislikes || 0);
        updateVoteStyles();
      }
    } catch (_) {}
  };

  const updateVoteStyles = () => {
    els.btnLike.classList.toggle('active', currentVote === 'like');
    els.btnDislike.classList.toggle('active', currentVote === 'dislike');
  };

  const castVote = async (action: 'like' | 'dislike') => {
    if (!activeSong || isVoting) return;
    const prev = currentVote;
    currentVote = currentVote === action ? null : action;
    updateVoteStyles();
    isVoting = true;

    const videoKey = activeSong.videoFile;
    try {
      const krId = await getKrId();
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: videoKey, action, ...(krId ? { kr_id: krId } : {}) }),
      });
      if (activeSong?.videoFile !== videoKey) return;
      if (res.ok) {
        const data = await res.json() as { liked: boolean; disliked: boolean; totalLikes: number; totalDislikes: number };
        currentVote = data.liked ? 'like' : data.disliked ? 'dislike' : null;
        els.likeCount.textContent = String(data.totalLikes || 0);
        els.dislikeCount.textContent = String(data.totalDislikes || 0);
        updateVoteStyles();
      } else {
        currentVote = prev;
        updateVoteStyles();
      }
    } catch (_) {
      if (activeSong?.videoFile !== videoKey) return;
      currentVote = prev;
      updateVoteStyles();
    } finally {
      isVoting = false;
    }
  };

  // ── View Counting (5.47s genuine-play threshold) ───────────────────────────
  // Rules:
  //   • Only fires once per song selection (resets on selectSong).
  //   • Does NOT fire if the play event is a resume from pause.
  //   • Fires when the video has played (not including paused time) for > 5.47s.
  let viewCountedForCurrentSong = false;
  let viewPlayTimer: ReturnType<typeof setTimeout> | null = null;
  let viewPlayStartedAt: number | null = null; // performance.now() when play started
  let viewAccumulatedTime = 0;               // ms of genuine play time accumulated
  const VIEW_THRESHOLD_MS = 5470;

  const clearViewTimer = () => {
    if (viewPlayTimer !== null) { clearTimeout(viewPlayTimer); viewPlayTimer = null; }
    viewPlayStartedAt = null;
  };

  const resetViewState = () => {
    clearViewTimer();
    viewCountedForCurrentSong = false;
    viewAccumulatedTime = 0;
  };

  const onVideoPlay = () => {
    if (viewCountedForCurrentSong || !activeSong) return;
    // Start accumulating time
    viewPlayStartedAt = performance.now();
    const remaining = VIEW_THRESHOLD_MS - viewAccumulatedTime;
    const videoKey = activeSong.videoFile;
    viewPlayTimer = setTimeout(async () => {
      if (viewCountedForCurrentSong || activeSong?.videoFile !== videoKey) return;
      viewCountedForCurrentSong = true;
      viewPlayTimer = null;
      // Fire-and-forget view increment
      try {
        const krId = await getKrId();
        await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: videoKey,
            count_view: true,
            ...(krId ? { kr_id: krId } : {}),
          }),
        });
      } catch (_) {}
    }, remaining);
  };

  const onVideoPause = () => {
    if (viewCountedForCurrentSong) return;
    // Accumulate play time so resuming doesn't restart the full clock
    if (viewPlayStartedAt !== null) {
      viewAccumulatedTime += performance.now() - viewPlayStartedAt;
    }
    clearViewTimer();
  };

  // Vocal Toggle & Floating Pointer Pilletje
  const toggleKaraokeMode = () => {
    if (!activeSong?.instrumentalUrl || !instrumentalAudio) return;
    isKaraokeMode = !isKaraokeMode;
    if (isKaraokeMode) {
      instrumentalAudio.currentTime = els.video.currentTime;
      instrumentalAudio.volume = els.video.volume;
      instrumentalAudio.muted = false;
      if (!els.video.paused) {
        instrumentalAudio.play().catch(e => console.warn('Stem play prevented:', e));
      }
      els.video.muted = true;
    } else {
      els.video.muted = false;
      instrumentalAudio.muted = true;
      instrumentalAudio.pause();
    }
    updateVoiceButtonState();
  };

  if (els.btnVoice) {
    els.btnVoice.addEventListener('click', toggleKaraokeMode);

    if (els.voicePointerPill) {
      const pill = els.voicePointerPill;
      els.btnVoice.addEventListener('mouseenter', (e) => {
        pill.textContent = isKaraokeMode ? 'Restore Vocals' : 'Remove Vocals';
        pill.style.display = 'block';
        pill.style.left = `${e.clientX}px`;
        pill.style.top = `${e.clientY}px`;
        requestAnimationFrame(() => pill.classList.add('visible'));
      });
      els.btnVoice.addEventListener('mousemove', (e) => {
        pill.style.left = `${e.clientX}px`;
        pill.style.top = `${e.clientY}px`;
      });
      els.btnVoice.addEventListener('mouseleave', () => {
        pill.classList.remove('visible');
        setTimeout(() => {
          if (!pill.classList.contains('visible')) pill.style.display = 'none';
        }, 150);
      });
    }
  }

  // Setup Event Listeners
  els.btnPlayPause.addEventListener('click', togglePlay);
  els.centerPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });
  els.video.addEventListener('click', togglePlay);

  els.video.addEventListener('play', () => {
    updatePlayStateIcons(true);
    onVideoPlay();
    if (isKaraokeMode && instrumentalAudio) {
      instrumentalAudio.currentTime = els.video.currentTime;
      instrumentalAudio.play().catch(e => console.warn('Stem play failed:', e));
    }
  });

  els.video.addEventListener('pause', () => {
    updatePlayStateIcons(false);
    onVideoPause();
    if (instrumentalAudio) {
      instrumentalAudio.pause();
    }
  });

  els.video.addEventListener('ended', () => {
    if (instrumentalAudio) {
      instrumentalAudio.pause();
    }
  });

  els.video.addEventListener('error', () => {
    console.error('Video playback error:', els.video.error);
    updatePlayStateIcons(false);
    onVideoPause();
    if (instrumentalAudio) {
      instrumentalAudio.pause();
    }
  });

  const onDurationReady = () => {
    if (els.video.duration) {
      const dur = formatTime(els.video.duration);
      if (els.timeDuration) els.timeDuration.textContent = dur;
      if (els.timeCurrent) els.timeCurrent.textContent = formatTime(els.video.currentTime);
      if (els.timecodeDisplay) els.timecodeDisplay.textContent = `${formatTime(els.video.currentTime)} / ${dur}`;
    }
    if (els.video.videoWidth && els.video.videoHeight) {
      const container = els.video.closest('.video-frame-container') as HTMLElement;
      if (container) {
        container.style.aspectRatio = `${els.video.videoWidth} / ${els.video.videoHeight}`;
        container.style.setProperty('--video-ratio', String(els.video.videoWidth / els.video.videoHeight));
      }
    }
  };

  els.video.addEventListener('loadedmetadata', onDurationReady);
  els.video.addEventListener('durationchange', onDurationReady);

  els.video.addEventListener('timeupdate', () => {
    if (els.video.duration) {
      const cur = formatTime(els.video.currentTime);
      const dur = formatTime(els.video.duration);
      if (els.timeCurrent) els.timeCurrent.textContent = cur;
      if (els.timeDuration) els.timeDuration.textContent = dur;
      if (els.timecodeDisplay) els.timecodeDisplay.textContent = `${cur} / ${dur}`;

      const pct = (els.video.currentTime / els.video.duration) * 100;
      els.progressBar.style.setProperty('--progress', `${pct}%`);
      if (!isDraggingScrubber) {
        els.progressBar.value = String(pct);
      }

      // Stem sync guard
      if (isKaraokeMode && instrumentalAudio && !els.video.paused) {
        const drift = Math.abs(instrumentalAudio.currentTime - els.video.currentTime);
        if (drift > 0.05) {
          instrumentalAudio.currentTime = els.video.currentTime;
        }
        if (instrumentalAudio.paused) {
          instrumentalAudio.play().catch(console.warn);
        }
      }
    }
  });

  els.progressBar.addEventListener('input', (e) => {
    isDraggingScrubber = true;
    const pct = parseFloat((e.target as HTMLInputElement).value);
    els.progressBar.style.setProperty('--progress', `${pct}%`);
    if (els.video.duration) {
      const targetTime = (pct / 100) * els.video.duration;
      els.video.currentTime = targetTime;
      if (isKaraokeMode && instrumentalAudio) {
        instrumentalAudio.currentTime = targetTime;
      }
      if (els.timeCurrent) els.timeCurrent.textContent = formatTime(els.video.currentTime);
    }
  });

  els.progressBar.addEventListener('change', () => {
    isDraggingScrubber = false;
  });

  // Volume & Mute
  const updateVolumeIcon = (vol: number, muted: boolean) => {
    if (muted || vol === 0) {
      els.volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
    } else if (vol < 0.5) {
      els.volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
    } else {
      els.volIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
    }
  };

  els.volInput.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    els.video.volume = val;
    if (instrumentalAudio) instrumentalAudio.volume = val;
    if (isKaraokeMode) {
      els.video.muted = true;
      if (instrumentalAudio) instrumentalAudio.muted = (val === 0);
    } else {
      els.video.muted = (val === 0);
    }
    if (val > 0) prevVolume = val;
    updateVolumeIcon(val, (val === 0));
  });

  els.volBtn.addEventListener('click', () => {
    const isCurrentlyMuted = isKaraokeMode ? (instrumentalAudio?.muted ?? false) : els.video.muted;
    if (isCurrentlyMuted || (isKaraokeMode ? instrumentalAudio?.volume === 0 : els.video.volume === 0)) {
      const restoreVol = prevVolume || 0.7;
      if (isKaraokeMode && instrumentalAudio) {
        instrumentalAudio.muted = false;
        instrumentalAudio.volume = restoreVol;
        els.video.muted = true;
      } else {
        els.video.muted = false;
        els.video.volume = restoreVol;
      }
      els.volInput.value = String(restoreVol);
      updateVolumeIcon(restoreVol, false);
    } else {
      prevVolume = isKaraokeMode && instrumentalAudio ? instrumentalAudio.volume : els.video.volume;
      if (isKaraokeMode && instrumentalAudio) {
        instrumentalAudio.muted = true;
      } else {
        els.video.muted = true;
      }
      els.volInput.value = '0';
      updateVolumeIcon(0, true);
    }
  });

  // Like & Dislike
  els.btnLike.addEventListener('click', () => castVote('like'));
  els.btnDislike.addEventListener('click', () => castVote('dislike'));

  // Shuffle
  els.btnShuffle.addEventListener('click', () => {
    const candidates = filteredSongs.filter(s => s.id !== activeSong?.id);
    if (candidates.length > 0) {
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      selectSong(next);
    }
  });

  // Fullscreen
  els.btnFullscreen.addEventListener('click', () => {
    const stageEl = (document.querySelector('.theater-stage') as HTMLElement) || els.videoContainer;
    if (!document.fullscreenElement) {
      stageEl.requestFullscreen().catch(console.warn);
    } else {
      document.exitFullscreen().catch(console.warn);
    }
  });

  // Fuzzy Search Pill
  els.searchPillInput.addEventListener('input', () => {
    const q = els.searchPillInput.value;
    els.searchPillClear.style.display = q ? 'block' : 'none';
    refreshSidebar();
  });

  els.searchPillClear.addEventListener('click', () => {
    els.searchPillInput.value = '';
    els.searchPillClear.style.display = 'none';
    refreshSidebar();
    els.searchPillInput.focus();
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // If typing in search pill, do not capture hotkeys except Escape
    if (document.activeElement === els.searchPillInput) {
      if (e.key === 'Escape') {
        els.searchPillInput.blur();
      }
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.searchPillInput.focus();
      els.searchPillInput.select();
    } else if (e.code === 'Space' || e.code === 'KeyK') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'KeyJ') {
      e.preventDefault();
      els.video.currentTime = Math.max(0, els.video.currentTime - 2);
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + 2);
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      els.volBtn.click();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      els.btnFullscreen.click();
    }
  });

  // Global Copy Protection: block all copying unless triggered by our share button
  let isInternalCopy = false;
  document.addEventListener('copy', (e) => {
    if (!isInternalCopy) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  // In-Theme Share Button next to Title
  let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  if (els.trackShareBtn) {
    els.trackShareBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!activeSong) return;
      const code = activeSong.shareCode || activeSong.id;
      const shareText = `karaoke.nixlabs.tech/${code}`;

      isInternalCopy = true;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareText);
        } else {
          const ta = document.createElement('textarea');
          ta.value = shareText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } catch (err) {
        console.warn('Clipboard write error:', err);
      } finally {
        setTimeout(() => { isInternalCopy = false; }, 100);
      }

      els.trackShareBtn!.classList.add('copied');
      if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
      shareCopiedTimer = setTimeout(() => {
        els.trackShareBtn!.classList.remove('copied');
        shareCopiedTimer = null;
      }, 1300); // exactly 1.3s
    });
  }

  // Top-Right "Support the Artist" Button & Dropdown Menu
  if (els.supportBtn && els.supportMenu) {
    els.supportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = els.supportMenu!.style.display === 'flex';
      els.supportMenu!.style.display = isOpen ? 'none' : 'flex';
    });

    document.addEventListener('click', (e) => {
      if (els.supportContainer && !els.supportContainer.contains(e.target as Node)) {
        els.supportMenu!.style.display = 'none';
      }
    });
  }

  // Initial Boot
  loadCatalog().then(catalog => {
    const urlParams = new URLSearchParams(window.location.search);
    // Local review uses the public player, with Vite serving the supplied media.
    // The override is available only in development and only when requested.
    if (import.meta.env.DEV && urlParams.get('preview') === 'fantaisie') {
      catalog = catalog.map(song => song.id === 'chopin-fantaisie-impromptu' ? {
        ...song,
        isOnR2: true,
        videoUrl: `/${encodeURIComponent('Fantaisie-impromptu op 66')}/${encodeURIComponent('fantaisie-tokyo-ghoul-final-720p.mp4')}`
      } : song);
    }
    allSongs = sortSongs(catalog.filter(s => s.isOnR2 && (s.hasLyrics || hasSongScore(s.id))));
    songsByMode = groupSongsByMode(allSongs, s => hasSongScore(s.id));

    const targetSongId = urlParams.get('song');
    const targetTime = parseFloat(urlParams.get('t') || urlParams.get('time') || '0');
    const linkedSong = targetSongId ? allSongs.find(s => s.id === targetSongId || s.shareCode === targetSongId) : undefined;

    setLibraryMode(resolveInitialMode(songsByMode, readStoredMode(), linkedSong), false);
    for (const mode of LIBRARY_MODES) els.libraryModeInputs[mode].disabled = false;
    requestAnimationFrame(() => els.libraryMode.classList.add('is-settled'));

    if (filteredSongs.length > 0) {
      const initialSong = linkedSong || filteredSongs[0];
      selectSong(initialSong).then(() => {
        if (targetTime > 0) {
          els.video.currentTime = targetTime;
          if (els.video.duration) {
            const cur = formatTime(targetTime);
            const dur = formatTime(els.video.duration);
            if (els.timeCurrent) els.timeCurrent.textContent = cur;
            if (els.timeDuration) els.timeDuration.textContent = dur;
            const pct = (targetTime / els.video.duration) * 100;
            els.progressBar.style.setProperty('--progress', `${pct}%`);
            els.progressBar.value = String(pct);
          }
        }
      });
    }
  });
}
