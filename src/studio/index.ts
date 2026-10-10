import { prepareProtectedPlayback } from '../security/playback';
import { loadCatalog, loadLyrics } from '../catalog/catalog';
import { parseRawLyrics } from '../core/tokenizer';
import { cleanVersePunctuation } from '../core/punctuation';
import { getStudioElements } from './dom';
import { state } from './state';
import { albumArtQuery, fetchAlbumArt } from '../catalog/itunes';
import { initPlayer } from './player';
import { renderMatrix, updateTelemetry } from './renderer';
import { initSyncEngine } from './syncEngine';
import { saveMaster } from './persistence';
import { initModals } from './modals';
import type { SongCatalogItem } from '../types/karaoke';
import type { FilterMode } from './types';

type TrackStatus = { label: string; dot: string };

function trackStatus(song: SongCatalogItem): TrackStatus {
  if (!song.isOnR2) return { label: 'No media', dot: 'missing' };
  return song.hasLyrics ? { label: 'Synced', dot: 'synced' } : { label: 'Needs sync', dot: 'needs-sync' };
}

export async function bootstrapStudio(): Promise<void> {
  const els = getStudioElements();
  const trackPicker = document.getElementById('track-picker') as HTMLElement;
  const trackPickerButton = document.getElementById('track-picker-button') as HTMLButtonElement;
  const trackPickerSelection = document.getElementById('track-picker-selection') as HTMLElement;
  const trackPickerList = document.getElementById('track-picker-list') as HTMLElement;

  const closeTrackPicker = (restoreFocus = false) => {
    trackPickerList.hidden = true;
    trackPickerButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trackPickerButton.focus();
  };

  const updateTrackSelection = (song: SongCatalogItem) => {
    const { label: status, dot: dotClass } = trackStatus(song);
    const dot = document.createElement('span');
    dot.className = `track-status-dot ${dotClass}`;
    dot.setAttribute('aria-hidden', 'true');
    const statusLabel = document.createElement('span');
    statusLabel.className = 'track-picker-current-status';
    statusLabel.textContent = status;
    const label = document.createElement('span');
    label.className = 'track-picker-label';
    label.textContent = `${song.artist} – ${song.title}`;
    trackPickerSelection.replaceChildren(dot, statusLabel, label);
    trackPickerButton.setAttribute('aria-label', `${status}: ${song.artist} – ${song.title}. Select track`);
    trackPickerButton.title = `${status}: ${song.artist} – ${song.title}`;
    trackPickerList.querySelectorAll<HTMLElement>('.track-picker-option').forEach(option => {
      const selected = option.dataset.trackId === song.id;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
  };

  const openTrackPicker = (last = false) => {
    if (trackPickerButton.disabled) return;
    trackPickerList.hidden = false;
    trackPickerButton.setAttribute('aria-expanded', 'true');
    const options = [...trackPickerList.querySelectorAll<HTMLButtonElement>('.track-picker-option')];
    const target = last ? options.at(-1) : options.find(option => option.getAttribute('aria-selected') === 'true') || options[0];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  };

  trackPickerButton.addEventListener('click', () => {
    if (trackPickerList.hidden) openTrackPicker();
    else closeTrackPicker();
  });
  trackPickerButton.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openTrackPicker(event.key === 'ArrowUp');
    }
  });
  trackPickerList.addEventListener('keydown', event => {
    const options = [...trackPickerList.querySelectorAll<HTMLButtonElement>('.track-picker-option')];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTrackPicker(true);
      return;
    }
    if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const query = event.key.toLocaleLowerCase();
      const ordered = [...options.slice(current + 1), ...options.slice(0, current + 1)];
      const match = ordered.find(option => option.querySelector('.track-option-name')?.textContent?.toLocaleLowerCase().startsWith(query));
      if (match) next = options.indexOf(match);
      else return;
    }
    else return;
    event.preventDefault();
    options[next]?.focus();
    options[next]?.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('pointerdown', event => {
    if (!trackPicker.contains(event.target as Node)) closeTrackPicker();
  });
  trackPicker.addEventListener('focusout', event => {
    if (!trackPicker.contains(event.relatedTarget as Node | null)) closeTrackPicker();
  });

  const showToast = (msg: string, isError = false) => {
    els.toastMessage.textContent = msg;
    els.toastDot.style.background = isError ? 'var(--accent-red)' : 'var(--accent-green)';
    els.toastHud.classList.add('show');
    setTimeout(() => els.toastHud.classList.remove('show'), 3000);
  };

  const refreshDropdown = () => {
    els.trackSelector.innerHTML = '';
    trackPickerList.replaceChildren();
    closeTrackPicker();
    const filtered = state.catalog.filter(song => {
      if (state.currentFilter === 'needs_sync') return !song.hasLyrics;
      if (state.currentFilter === 'synced') return song.hasLyrics;
      return true;
    });

    filtered.forEach(song => {
      const opt = document.createElement('option');
      opt.value = song.id;
      const statusIcon = !song.isOnR2 
        ? '🔴 [NO MEDIA]' 
        : (!song.hasLyrics ? '🟡 [NEEDS SYNC]' : '🟢 [SYNCED]');
      opt.textContent = `${statusIcon} ${song.artist} - ${song.title}`;
      els.trackSelector.appendChild(opt);

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'track-picker-option';
      item.setAttribute('role', 'option');
      item.dataset.trackId = song.id;
      const { label: statusLabel, dot: dotClass } = trackStatus(song);
      const dot = document.createElement('span');
      dot.className = `track-status-dot ${dotClass}`;
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'track-option-name';
      name.textContent = `${song.artist} – ${song.title}`;
      const status = document.createElement('span');
      status.className = 'track-option-status';
      status.textContent = statusLabel;
      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(status);
      item.addEventListener('click', () => {
        closeTrackPicker(true);
        loadSelectedSong(song.id);
      });
      trackPickerList.appendChild(item);
    });

    trackPickerButton.disabled = filtered.length === 0;
    if (filtered.length > 0) {
      if (!state.activeSong || !filtered.some(s => s.id === state.activeSong?.id)) {
        loadSelectedSong(filtered[0].id);
      } else {
        els.trackSelector.value = state.activeSong.id;
        updateTrackSelection(state.activeSong);
      }
    } else {
      trackPickerSelection.textContent = 'No tracks in this filter';
      trackPickerButton.setAttribute('aria-label', 'No tracks in this filter');
    }
  };

  const loadSelectedSong = async (songId: string) => {
    const song = state.catalog.find(s => s.id === songId);
    if (!song) return;

    state.activeSong = song;
    els.trackSelector.value = song.id;
    updateTrackSelection(song);

    // Left Panel Metadata
    els.metaId.value = song.id;
    els.metaTitle.value = song.title;
    els.metaArtist.value = song.artist;
    els.metaItunesTrack.value = song.itunesTrack || '';
    els.metaItunesArtist.value = song.itunesArtist || '';
    els.metaHasTranslation.checked = !!song.hasTranslation;
    els.metaIsDialect.checked = !!song.isDialect;

    state.globalOffset = song.globalOffset || 0;
    els.offsetDisplay.textContent = `${state.globalOffset >= 0 ? '+' : ''}${state.globalOffset.toFixed(2)}s`;

    els.statsR2Status.textContent = song.isOnR2 ? '🟢 In Media Bucket' : '🔴 Missing on R2';
    els.statsR2Status.style.color = song.isOnR2 ? 'var(--accent-green)' : 'var(--accent-red)';

    fetchAlbumArt(albumArtQuery(song), els.trackArtImg, { badgeEl: els.artStatusBadge });

    // Video stream
    await prepareProtectedPlayback(song.id);
    els.vid.src = song.videoUrl;
    els.vid.playbackRate = state.playbackRate;
    els.vid.currentTime = 0;

    // Load Lyrics
    const lyricsDoc = await loadLyrics(song.id);
    const parsedLyrics = lyricsDoc?.lyricsData ? JSON.parse(JSON.stringify(lyricsDoc.lyricsData)) : [];
    state.localLyrics = cleanVersePunctuation(parsedLyrics);
    state.currentV = 0;
    state.currentW = 0;

    renderMatrix(els, playerController.renderBlocks);
    playerController.renderBlocks();
    updateTelemetry(els);
  };

  // Initialize Player
  const playerController = initPlayer(els);

  // Initialize Modals
  const modalController = initModals(
    els,
    showToast,
    () => {
      renderMatrix(els, playerController.renderBlocks);
      playerController.renderBlocks();
      updateTelemetry(els);
    },
    (newSong: SongCatalogItem) => {
      state.catalog.unshift(newSong);
      refreshDropdown();
      loadSelectedSong(newSong.id);
    }
  );

  // Initialize Keyboard Tap-to-Sync & Transports
  initSyncEngine(
    els,
    () => saveMaster(els, showToast, modalController.openExportModal, refreshDropdown),
    playerController.renderBlocks,
    playerController.togglePlay
  );

  // Track Selector Change
  els.trackSelector.addEventListener('change', (e) => {
    loadSelectedSong((e.target as HTMLSelectElement).value);
  });

  // Sidebar Toggle
  els.btnToggleSidebar?.addEventListener('click', () => {
    els.studioGrid?.classList.toggle('sidebar-collapsed');
    playerController.renderBlocks();
  });

  // Filter Tabs
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = (btn.getAttribute('data-filter') || 'all') as FilterMode;
      refreshDropdown();
    });
  });

  // Wipe Timestamps
  els.btnWipe.addEventListener('click', () => {
    if (confirm('Wipe ALL timestamps for this track? Words will remain, but timing will reset to 0.')) {
      state.localLyrics.forEach(v => {
        v.verseStart = 0;
        v.verseEnd = 0;
        v.words.forEach(w => {
          w.start = 0;
          w.end = 0;
        });
      });
      state.currentV = 0;
      state.currentW = 0;
      els.vid.currentTime = 0;
      renderMatrix(els, playerController.renderBlocks);
      playerController.renderBlocks();
      updateTelemetry(els);
      showToast('Timings wiped. Ready for fresh sync.');
    }
  });

  // Add Verse
  els.btnAddVerse.addEventListener('click', () => {
    const text = prompt('Enter verse line (or leave blank for empty template):');
    if (text !== null) {
      const newVerses = parseRawLyrics(text || 'VerseWord ');
      if (newVerses.length > 0) {
        state.localLyrics.push(...newVerses);
      } else {
        state.localLyrics.push({ verseStart: 0, verseEnd: 0, words: [{ word: 'Word ', start: 0, end: 0 }] });
      }
      renderMatrix(els, playerController.renderBlocks);
      playerController.renderBlocks();
      updateTelemetry(els);
    }
  });

  // Save Master Buttons
  const triggerSave = () => {
    saveMaster(els, showToast, modalController.openExportModal, refreshDropdown);
  };
  els.btnSaveMaster.addEventListener('click', triggerSave);
  els.btnSaveTelemetry?.addEventListener('click', triggerSave);
  els.btnSaveDeck?.addEventListener('click', triggerSave);

  // Boot initial catalog
  try {
    const loaded = await loadCatalog();
    state.catalog = loaded;
    refreshDropdown();
  } catch (err) {
    console.error('Failed to load initial catalog:', err);
  }
}

// Auto-run on DOM ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bootstrapStudio);
}
