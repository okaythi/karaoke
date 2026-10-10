import { albumArtQuery, fetchAlbumArt } from '../catalog/itunes';
import { escapeHtml } from '../core/html';
import type { SongCatalogItem } from '../types/karaoke';
import { byId } from './dom';
import { fuzzyFilterSongs } from './fuzzySearch';
import { LIBRARY_MODES, groupSongsByMode, otherMode, readStoredMode, resolveInitialMode, storeMode, type LibraryMode, type SongsByMode } from './libraryMode';

export interface Library {
  /** Replaces the songs on offer, keeping the mode and the search. */
  setCatalog(songs: SongCatalogItem[], hasScore: (song: SongCatalogItem) => boolean): void;
  /** Settles the starting mode, so that a linked song is in the list shown, and unlocks the switch. */
  open(linked?: SongCatalogItem): void;
  setActive(songId: string): void;
  /** The songs listed now, in order. */
  visibleSongs(): SongCatalogItem[];
  focusSearch(): void;
  /** Whether typing currently goes to the search box. A press of Escape there leaves it. */
  ownsKey(event: KeyboardEvent): boolean;
}

const COPY: Record<LibraryMode, { label: string; one: string; many: string; placeholder: string }> = {
  lyrics: { label: 'Lyrics', one: 'song', many: 'songs', placeholder: 'Search songs or artists...' },
  piano: { label: 'Piano', one: 'piece', many: 'pieces', placeholder: 'Search pieces or composers...' }
};

/** Cover placeholders until the artwork arrives, cycled down the list. */
const PLACEHOLDER_COLOURS = ['#c5a14c', '#4b5366', '#a66887', '#8a6448', '#547770', '#556d8a', '#7d7367', '#6e6284'];
/** Cards are 32px wide; this covers a 3x screen. */
const CARD_ART_SIZE = 120;

function createCard(song: SongCatalogItem, colour: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'song-card';
  card.dataset.id = song.id;

  const placeholder = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='${encodeURIComponent(colour)}'><rect width='44' height='44' rx='4'/></svg>`;
  const badge = !song.hasTranslation ? ''
    : song.isDialect ? '<span class="badge badge-dialect" title="Dialect Vernacular">Dialect</span>'
    : '<span class="badge badge-trans" title="Localized Translation">SUB</span>';
  card.innerHTML = `
    <span class="song-card-num"></span>
    <img class="song-card-art" src="${placeholder}" alt="" />
    <div class="song-card-info">
      <div class="song-card-title">${escapeHtml(song.title)}</div>
      <div class="song-card-artist">${escapeHtml(song.artist)}</div>
    </div>
    ${badge}
  `;
  fetchAlbumArt(albumArtQuery(song), card.querySelector<HTMLImageElement>('.song-card-art')!, { size: CARD_ART_SIZE });
  return card;
}

/** The song list with its search box and Lyrics/Piano switch. Playback carries on whatever it shows. */
export function createLibrary(onSelect: (song: SongCatalogItem) => void): Library {
  const list = byId('sidebar-song-list');
  const search = byId<HTMLInputElement>('search-pill-input');
  const clearSearch = byId<HTMLButtonElement>('search-pill-clear');
  const status = byId('song-list-status');
  const modeSwitch = byId('library-mode');
  const modeInputs = { lyrics: byId<HTMLInputElement>('library-mode-lyrics'), piano: byId<HTMLInputElement>('library-mode-piano') };
  const modeCounts = { lyrics: byId('library-mode-lyrics-count'), piano: byId('library-mode-piano-count') };

  let songsByMode: SongsByMode = { lyrics: [], piano: [] };
  let mode: LibraryMode = 'lyrics';
  let visible: SongCatalogItem[] = [];
  let activeId: string | null = null;
  // Cards outlive searches and catalog updates, so a cover is looked up once per song.
  const cards = new Map<string, HTMLElement>();

  const cardFor = (song: SongCatalogItem): HTMLElement => {
    let card = cards.get(song.id);
    if (!card) {
      card = createCard(song, PLACEHOLDER_COLOURS[cards.size % PLACEHOLDER_COLOURS.length]);
      cards.set(song.id, card);
    }
    return card;
  };

  // The list is empty: say why, and point at the other mode when the search matches there.
  const showEmpty = (query: string, matchesElsewhere: number) => {
    const other = otherMode(mode);
    const title = query ? `No ${COPY[mode].many} match “${escapeHtml(query)}”` : `No ${COPY[mode].many} yet`;
    const hint = !query ? ''
      : matchesElsewhere > 0
        ? `<button class="empty-search-switch" type="button">${matchesElsewhere} ${matchesElsewhere === 1 ? 'match' : 'matches'} in ${COPY[other].label}</button>`
        : '<div class="empty-search-hint">Try a different title or artist</div>';
    list.innerHTML = `<div class="empty-search-state"><div class="empty-search-title">${title}</div>${hint}</div>`;
    list.querySelector('.empty-search-switch')?.addEventListener('click', () => {
      setMode(other);
      modeInputs[other].focus();
    });
  };

  // Redraws the list for the current mode and search; the counts show what the search finds in each mode.
  const refresh = () => {
    const query = search.value.trim();
    clearSearch.hidden = !search.value;
    const matches = {
      lyrics: fuzzyFilterSongs(songsByMode.lyrics, query),
      piano: fuzzyFilterSongs(songsByMode.piano, query)
    };
    for (const each of LIBRARY_MODES) modeCounts[each].textContent = String(matches[each].length);

    visible = matches[mode];
    status.textContent = `${visible.length} ${visible.length === 1 ? COPY[mode].one : COPY[mode].many}`;
    if (visible.length === 0) {
      showEmpty(query, matches[otherMode(mode)].length);
      return;
    }
    list.replaceChildren(...visible.map((song, index) => {
      const card = cardFor(song);
      card.classList.toggle('active', song.id === activeId);
      card.querySelector('.song-card-num')!.textContent = String(index + 1).padStart(2, '0');
      return card;
    }));
  };

  const setMode = (next: LibraryMode, remember = true) => {
    mode = next;
    modeInputs[next].checked = true;
    search.placeholder = COPY[next].placeholder;
    if (remember) storeMode(next);
    list.scrollTop = 0;
    refresh();
  };

  for (const each of LIBRARY_MODES) modeInputs[each].addEventListener('change', () => setMode(each));

  list.addEventListener('click', event => {
    const id = (event.target as Element).closest<HTMLElement>('.song-card')?.dataset.id;
    const song = visible.find(candidate => candidate.id === id);
    if (song) onSelect(song);
  });

  search.addEventListener('input', refresh);
  clearSearch.addEventListener('click', () => {
    search.value = '';
    refresh();
    search.focus();
  });

  return {
    setCatalog(songs, hasScore) {
      songsByMode = groupSongsByMode(songs, hasScore);
      const offered = new Set(songs.map(song => song.id));
      for (const id of cards.keys()) if (!offered.has(id)) cards.delete(id);
      refresh();
    },
    open(linked) {
      setMode(resolveInitialMode(songsByMode, readStoredMode(), linked), false);
      for (const each of LIBRARY_MODES) modeInputs[each].disabled = false;
      requestAnimationFrame(() => modeSwitch.classList.add('is-settled'));
    },
    setActive(songId) {
      activeId = songId;
      for (const [id, card] of cards) card.classList.toggle('active', id === songId);
    },
    visibleSongs: () => visible,
    focusSearch() {
      search.focus();
      search.select();
    },
    ownsKey(event) {
      if (document.activeElement !== search) return false;
      if (event.key === 'Escape') search.blur();
      return true;
    }
  };
}
