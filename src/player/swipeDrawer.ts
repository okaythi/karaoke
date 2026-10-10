/**
 * Slide-out song-list drawer on every screen.
 *
 * Swiping right anywhere on the stage pulls the drawer out under the finger,
 * swiping left (or tapping the scrim) pushes it back, and the pull tab on the
 * drawer's edge works as a plain button. The drawer follows the finger and
 * settles on release by position and flick velocity. Mouse input keeps to
 * clicks through the header toggle.
 */

export interface SwipeDrawerOptions {
  /** Element that carries the `sidebar-open` state class. */
  app: HTMLElement;
  drawer: HTMLElement;
  handle: HTMLButtonElement;
  scrim: HTMLElement;
  /** Header toggle still used outside portrait. */
  toggle?: HTMLButtonElement | null;
}

export interface SwipeDrawerController {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

const HINT_QUERY = '(max-width: 768px) and (orientation: portrait)';
const HINT_STORAGE_KEY = 'karaoke.drawerHintSeen';
const DRAG_SLOP_PX = 10;
const FLICK_PROJECTION_MS = 140;
// Gestures never start on controls that need horizontal drags or taps of their own.
const NO_SWIPE_SELECTOR = 'input, select, textarea, a, button:not(.drawer-handle), nixlabs-account, .support-menu';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  width: number;
  offset: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  dragging: boolean;
}

export function createSwipeDrawer({ app, drawer, handle, scrim, toggle }: SwipeDrawerOptions): SwipeDrawerController {
  let isOpen = app.classList.contains('sidebar-open') || matchMedia('(min-width: 769px)').matches;
  let drag: DragState | null = null;
  let suppressClickUntil = 0;

  const setOpen = (next: boolean) => {
    isOpen = next;
    app.classList.toggle('sidebar-open', next);
    const expanded = String(next);
    handle.setAttribute('aria-expanded', expanded);
    toggle?.setAttribute('aria-expanded', expanded);
    // Keep the pull tab accessible while closed; hidden list controls cannot receive focus.
    for (const child of Array.from(drawer.children)) {
      if (child instanceof HTMLElement && child !== handle) child.inert = !next;
    }
    if (!next && drawer.contains(document.activeElement)) toggle?.focus();
  };

  const applyOffset = (offset: number, width: number) => {
    drawer.style.transform = `translateX(${offset - width}px)`;
    app.style.setProperty('--drawer-progress', String(width > 0 ? offset / width : 0));
  };

  const endDrag = () => {
    drag = null;
    app.classList.remove('drawer-dragging');
    drawer.style.removeProperty('transform');
    app.style.removeProperty('--drawer-progress');
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || drag) return;
    const target = event.target as Element | null;
    if (!target || target.closest(NO_SWIPE_SELECTOR)) return;
    // A closed drawer opens from the stage or its pull tab; an open one closes from anywhere.
    if (!isOpen && drawer.contains(target) && !handle.contains(target)) return;
    const width = drawer.getBoundingClientRect().width;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: isOpen ? width : 0,
      width,
      offset: isOpen ? width : 0,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      dragging: false
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) return;
      // Vertical movement belongs to scrolling; a push the wrong way is not a drawer gesture.
      if (Math.abs(dy) > Math.abs(dx) || (isOpen ? dx > 0 : dx < 0)) {
        drag = null;
        return;
      }
      drag.dragging = true;
      app.classList.remove('drawer-hint');
      app.classList.add('drawer-dragging');
      try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* pointer already released */ }
    }
    const elapsed = event.timeStamp - drag.lastTime;
    if (elapsed > 0) {
      const instant = (event.clientX - drag.lastX) / elapsed;
      drag.velocity = drag.velocity * 0.6 + instant * 0.4;
    }
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    drag.offset = Math.max(0, Math.min(drag.width, drag.startOffset + dx));
    applyOffset(drag.offset, drag.width);
    event.preventDefault();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.dragging) {
      drag = null;
      return;
    }
    const projected = drag.offset + drag.velocity * FLICK_PROJECTION_MS;
    const next = event.type === 'pointercancel'
      ? drag.offset > drag.width / 2
      : projected > drag.width / 2;
    // The release lands on whatever was under the finger; it must not also play, pause or pick a song.
    suppressClickUntil = event.timeStamp + 400;
    endDrag();
    setOpen(next);
  };

  const onClickCapture = (event: MouseEvent) => {
    if (event.timeStamp > suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  const onDrawerClick = (event: MouseEvent) => {
    // Picking a song hands the screen back to the player.
    if (isOpen && (event.target as Element | null)?.closest('.song-card')) setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !isOpen) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    setOpen(false);
  };

  const onHandleClick = () => setOpen(!isOpen);
  const onToggleClick = () => setOpen(!isOpen);
  const onScrimClick = () => setOpen(false);

  // One gentle peek on a phone's first visit shows that the drawer can be pulled.
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const showHintOnce = () => {
    if (!matchMedia(HINT_QUERY).matches || isOpen) return;
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY)) return;
      localStorage.setItem(HINT_STORAGE_KEY, '1');
    } catch {
      return;
    }
    hintTimer = setTimeout(() => {
      if (isOpen || drag) return;
      app.classList.add('drawer-hint');
      const onHintEnd = (event: AnimationEvent) => {
        // Logo animations inside the drawer bubble up here too.
        if (event.target !== drawer) return;
        drawer.removeEventListener('animationend', onHintEnd);
        app.classList.remove('drawer-hint');
      };
      drawer.addEventListener('animationend', onHintEnd);
    }, 1400);
  };

  app.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('keydown', onKeyDown);
  drawer.addEventListener('click', onDrawerClick);
  handle.addEventListener('click', onHandleClick);
  toggle?.addEventListener('click', onToggleClick);
  scrim.addEventListener('click', onScrimClick);
  setOpen(isOpen);
  showHintOnce();

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen),
    destroy() {
      clearTimeout(hintTimer);
      endDrag();
      app.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      drawer.removeEventListener('click', onDrawerClick);
      handle.removeEventListener('click', onHandleClick);
      toggle?.removeEventListener('click', onToggleClick);
      scrim.removeEventListener('click', onScrimClick);
    }
  };
}
