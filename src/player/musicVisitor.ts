/** One tooltip for the whole voting group, shared by both buttons. */
export function initMusicVisitorControls(): void {
  if (!document.documentElement.classList.contains('music-visitor')) return;
  const group = document.getElementById('deck-vote-group');
  const tooltip = document.getElementById('vote-tooltip');
  if (!group || !tooltip) return;

  group.tabIndex = 0;
  group.setAttribute('aria-describedby', tooltip.id);

  for (const button of group.querySelectorAll('button')) {
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-describedby', tooltip.id);
    button.removeAttribute('title');
  }

  const position = (x: number, y: number) => {
    tooltip.hidden = false;
    const rect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - rect.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, y + 16 + rect.height > window.innerHeight - 8 ? y - rect.height - 12 : y + 16)}px`;
  };
  const hide = () => { tooltip.hidden = true; };
  group.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') position(event.clientX, event.clientY);
  });
  group.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') position(event.clientX, event.clientY);
  });
  group.addEventListener('pointerleave', hide);
  group.addEventListener('focusin', () => {
    const rect = group.getBoundingClientRect();
    position(rect.left, rect.top);
  });
  group.addEventListener('focusout', event => {
    if (!group.contains(event.relatedTarget as Node | null)) hide();
  });
  window.addEventListener('blur', hide);
}
