import type { SongCatalogItem } from '../types/karaoke';
import { loadCatalog, loadLyrics } from '../catalog/catalog';
import { fetchAlbumArt } from '../catalog/itunes';
import { createRenderEngine, type RenderEngineController } from '../renderer/renderEngine';
import { initDynamicBacklight } from '../renderer/backlight';
import { fuzzyFilterSongs } from './fuzzySearch';

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
  activeArtist: HTMLElement;
  badgeTranslation: HTMLElement;
  badgeDialect: HTMLElement;

  // Transport Deck
  btnPlayPause: HTMLButtonElement;
  playIcon: SVGElement;
  pauseIcon: SVGElement;
  timecodeDisplay: HTMLElement;
  progressBar: HTMLInputElement;
  volBtn: HTMLButtonElement;
  volIcon: HTMLElement;
  volInput: HTMLInputElement;
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

  const renderSidebar = (songs: SongCatalogItem[]) => {
    els.sidebarList.innerHTML = '';
    els.songCountBadge.textContent = `${songs.length} track${songs.length === 1 ? '' : 's'}`;

    if (songs.length === 0) {
      els.sidebarList.innerHTML = `
        <div class="empty-search-state">
          <div class="empty-search-icon">🔍</div>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">No matching songs</div>
          <div style="font-size: 12px; color: var(--text-muted);">Try a different keyword or artist name</div>
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
          : `<span class="badge badge-trans" title="Localized Translation">Sub</span>`;
      }

      const trackNum = String(idx + 1).padStart(2, '0');

      item.innerHTML = `
        <span class="song-card-num">${trackNum}</span>
        <img class="song-card-art" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='%231a1a24'><rect width='44' height='44' rx='6'/><circle cx='22' cy='22' r='10' fill='%23262636'/></svg>" alt="" />
        <div class="song-card-info">
          <div class="song-card-title">${song.title}</div>
          <div class="song-card-artist">${song.artist}</div>
        </div>
        ${badgesHTML}
      `;

      // Fetch artwork for card
      const imgEl = item.querySelector('.song-card-art') as HTMLImageElement;
      fetchAlbumArt(queryArtist, queryTrack, imgEl);

      item.addEventListener('click', () => {
        selectSong(song);
      });

      els.sidebarList.appendChild(item);
    });
  };

  const selectSong = async (song: SongCatalogItem) => {
    if (activeSong?.id === song.id && !els.video.paused) return;

    activeSong = song;

    // Highlight active card in sidebar
    els.sidebarList.querySelectorAll('.song-card').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-id') === song.id);
    });

    // Update active metadata in header
    els.activeTitle.textContent = song.title;
    els.activeArtist.textContent = song.artist;
    els.badgeTranslation.style.display = song.hasTranslation && !song.isDialect ? 'inline-flex' : 'none';
    els.badgeDialect.style.display = song.hasTranslation && song.isDialect ? 'inline-flex' : 'none';

    fetchAlbumArt(
      song.itunesArtist || song.artist,
      song.itunesTrack || song.title,
      els.activeArtwork
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
    els.video.src = song.videoUrl;
    els.video.load();
    els.video.currentTime = 0;
    els.progressBar.value = '0';
    els.timecodeDisplay.textContent = '0:00 / 0:00';

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

  // Voting Integration (D1 Database)
  let currentVote: 'like' | 'dislike' | null = null;
  let isVoting = false;

  const fetchVoteData = async (videoKey: string) => {
    try {
      const res = await fetch(`/api/vote?file_name=${encodeURIComponent(videoKey)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.liked) currentVote = 'like';
        else if (data.disliked) currentVote = 'dislike';
        else currentVote = null;

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
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: activeSong.videoFile, action })
      });
      if (res.ok) {
        const data = await res.json();
        els.likeCount.textContent = String(data.totalLikes || 0);
        els.dislikeCount.textContent = String(data.totalDislikes || 0);
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

  // Setup Event Listeners
  els.btnPlayPause.addEventListener('click', togglePlay);
  els.centerPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });
  els.video.addEventListener('click', togglePlay);

  els.video.addEventListener('play', () => updatePlayStateIcons(true));
  els.video.addEventListener('pause', () => updatePlayStateIcons(false));
  els.video.addEventListener('error', () => {
    console.error('Video playback error:', els.video.error);
    updatePlayStateIcons(false);
  });

  els.video.addEventListener('timeupdate', () => {
    if (els.video.duration) {
      els.timecodeDisplay.textContent = `${formatTime(els.video.currentTime)} / ${formatTime(els.video.duration)}`;
      if (!isDraggingScrubber) {
        els.progressBar.value = String((els.video.currentTime / els.video.duration) * 100);
      }
    }
  });

  els.progressBar.addEventListener('input', (e) => {
    isDraggingScrubber = true;
    const pct = parseFloat((e.target as HTMLInputElement).value);
    if (els.video.duration) {
      els.video.currentTime = (pct / 100) * els.video.duration;
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
    if (!document.fullscreenElement) {
      els.videoContainer.requestFullscreen().catch(console.warn);
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
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      els.btnFullscreen.click();
    }
  });

  // Initial Boot
  loadCatalog().then(catalog => {
    allSongs = catalog.filter(s => s.isOnR2 && s.hasLyrics);
    filteredSongs = allSongs;
    renderSidebar(filteredSongs);

    if (filteredSongs.length > 0) {
      selectSong(filteredSongs[0]);
    }
  });
}
