import type { SongCatalogItem } from '../types/karaoke';
import { loadCatalog, loadLyrics } from '../catalog/catalog';
import { fetchAlbumArt } from '../catalog/itunes';
import { sortSongs } from '../catalog/sorter';
import { createRenderEngine, type RenderEngineController } from '../renderer/renderEngine';
import { initDynamicBacklight } from '../renderer/backlight';
import { fuzzyFilterSongs } from './fuzzySearch';
import { collectFingerprint } from '../fingerprint/fingerprint';
import { VocalProcessor } from './vocalProcessor';

export interface PlayerElements {
  // Sidebar & Search Pill
  sidebarList: HTMLElement;
  searchPillInput: HTMLInputElement;
  searchPillClear: HTMLButtonElement;
  songCountBadge: HTMLElement;

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
  btnVocal?: HTMLButtonElement;
  vocalIconOn?: SVGElement;
  vocalIconOff?: SVGElement;
  vocalPill?: HTMLElement;
  vocalPillText?: HTMLElement;
  btnLike: HTMLButtonElement;
  btnDislike: HTMLButtonElement;
  likeCount: HTMLElement;
  dislikeCount: HTMLElement;
  btnShuffle: HTMLButtonElement;
  btnFullscreen: HTMLButtonElement;
}

export function initKaraokeTheater(els: PlayerElements) {
  let allSongs: SongCatalogItem[] = [];
  let filteredSongs: SongCatalogItem[] = [];
  let activeSong: SongCatalogItem | null = null;
  let renderController: RenderEngineController | null = null;
  let backlightController: { destroy: () => void } | null = null;
  let prevVolume = 0.7;
  let isDraggingScrubber = false;

  const updateVocalUI = (isMuted: boolean) => {
    if (els.btnVocal) {
      els.btnVocal.classList.toggle('active', isMuted);
      els.btnVocal.setAttribute('aria-pressed', String(isMuted));
    }
    if (els.vocalIconOn && els.vocalIconOff) {
      els.vocalIconOn.style.display = isMuted ? 'none' : 'block';
      els.vocalIconOff.style.display = isMuted ? 'block' : 'none';
    }
    if (els.vocalPillText) {
      els.vocalPillText.textContent = isMuted ? 'Restore Vocals' : 'Remove Vocals';
    }
    if (els.vocalPill) {
      els.vocalPill.classList.toggle('karaoke-active', isMuted);
    }
  };

  const vocalProcessor = new VocalProcessor({
    video: els.video,
    onStateChange: (isMuted) => {
      updateVocalUI(isMuted);
    }
  });

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

  const togglePlay = () => {
    if (els.video.paused) {
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

  const renderSidebar = (songs: SongCatalogItem[]) => {
    els.sidebarList.innerHTML = '';
    els.songCountBadge.textContent = `${songs.length} track${songs.length === 1 ? '' : 's'} in queue`;

    if (songs.length === 0) {
      els.sidebarList.innerHTML = `
        <div class="empty-search-state">
          <div class="empty-search-icon">🔍</div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">No matching songs</div>
          <div style="font-size: 12px; color: var(--theater-text-muted);">Try a different keyword or artist name</div>
        </div>
      `;
      return;
    }

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
          <div class="song-card-title">${song.title}</div>
          <div class="song-card-artist">${song.artist}</div>
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

  const selectSong = async (song: SongCatalogItem) => {
    if (activeSong?.id === song.id && !els.video.paused) return;

    activeSong = song;
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
            <a href="${item.itemLink}" target="_blank" rel="noopener noreferrer" class="support-menu-item">
              <span>${item.itemName}</span>
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

    // Load lyrics and media
    vocalProcessor.setTrackHasStems(!!song.hasStems);
    els.video.src = song.videoUrl;
    els.video.load();
    els.video.currentTime = 0;
    els.progressBar.value = '0';
    els.progressBar.style.setProperty('--progress', '0%');
    if (els.timeCurrent) els.timeCurrent.textContent = '0:00';
    if (els.timeDuration) els.timeDuration.textContent = '0:00';
    if (els.timecodeDisplay) els.timecodeDisplay.textContent = '0:00 / 0:00';

    const lyricFile = await loadLyrics(song.id);
    const verses = lyricFile?.lyricsData || [];

    // Initialize 60 FPS Render Engine
    renderController = createRenderEngine({
      videoElement: els.video,
      containerElement: els.lyricsContainer,
      topLineElement: els.lineTop,
      bottomLineElement: els.lineBottom,
      lyricsData: verses,
      globalOffset: song.globalOffset || 0
    });

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

    try {
      const krId = await getKrId();
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: activeSong.videoFile, action, ...(krId ? { kr_id: krId } : {}) }),
      });
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
    viewPlayTimer = setTimeout(async () => {
      if (viewCountedForCurrentSong || !activeSong) return;
      viewCountedForCurrentSong = true;
      viewPlayTimer = null;
      // Fire-and-forget view increment
      try {
        const krId = await getKrId();
        await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: activeSong.videoFile,
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
    vocalProcessor.initAudio();
  });
  els.video.addEventListener('pause', () => { updatePlayStateIcons(false); onVideoPause(); });
  els.video.addEventListener('error', () => {
    console.error('Video playback error:', els.video.error);
    updatePlayStateIcons(false);
    onVideoPause();
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
    }
  });

  els.progressBar.addEventListener('input', (e) => {
    isDraggingScrubber = true;
    const pct = parseFloat((e.target as HTMLInputElement).value);
    els.progressBar.style.setProperty('--progress', `${pct}%`);
    if (els.video.duration) {
      els.video.currentTime = (pct / 100) * els.video.duration;
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
    els.video.muted = (val === 0);
    if (val > 0) prevVolume = val;
    updateVolumeIcon(val, els.video.muted);
  });

  els.volBtn.addEventListener('click', () => {
    if (els.video.muted || els.video.volume === 0) {
      els.video.muted = false;
      els.video.volume = prevVolume || 0.7;
      els.volInput.value = String(els.video.volume);
    } else {
      prevVolume = els.video.volume;
      els.video.muted = true;
      els.volInput.value = '0';
    }
    updateVolumeIcon(els.video.volume, els.video.muted);
  });

  // Vocal Toggle Button & Pointer-Following Pilletje
  if (els.btnVocal) {
    els.btnVocal.addEventListener('click', () => {
      vocalProcessor.toggle();
    });

    if (els.vocalPill) {
      els.btnVocal.addEventListener('mouseenter', () => {
        updateVocalUI(vocalProcessor.isVoiceMuted());
        els.vocalPill?.classList.add('visible');
      });

      els.btnVocal.addEventListener('mousemove', (e: MouseEvent) => {
        if (!els.vocalPill) return;
        els.vocalPill.style.left = `${e.clientX}px`;
        els.vocalPill.style.top = `${e.clientY - 12}px`;
      });

      els.btnVocal.addEventListener('mouseleave', () => {
        els.vocalPill?.classList.remove('visible');
      });
    }
  }

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
    filteredSongs = fuzzyFilterSongs(allSongs, q);
    renderSidebar(filteredSongs);
  });

  els.searchPillClear.addEventListener('click', () => {
    els.searchPillInput.value = '';
    els.searchPillClear.style.display = 'none';
    filteredSongs = allSongs;
    renderSidebar(filteredSongs);
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
    } else if (e.code === 'KeyV') {
      e.preventDefault();
      vocalProcessor.toggle();
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
    allSongs = sortSongs(catalog.filter(s => s.isOnR2 && s.hasLyrics));
    filteredSongs = allSongs;
    renderSidebar(filteredSongs);

    const urlParams = new URLSearchParams(window.location.search);
    const targetSongId = urlParams.get('song');
    const targetTime = parseFloat(urlParams.get('t') || urlParams.get('time') || '0');

    if (filteredSongs.length > 0) {
      const initialSong = (targetSongId && filteredSongs.find(s => s.id === targetSongId || s.shareCode === targetSongId)) || filteredSongs[0];
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
