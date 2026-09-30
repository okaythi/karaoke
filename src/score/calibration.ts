import { classifyMidiNotes } from './classify';
import { saveDevelopmentOverrides } from './load';
import type { ClassifiedNote, PedalInterval, SemanticVoice, VoiceOverrides } from './model';
import type { ScoreRenderController } from './render';
import type { EngravedEvent } from './notation';

interface CalibrationScore {
  notes: ClassifiedNote[];
  pedals: PedalInterval[];
  notation: EngravedEvent[];
  mediaOffsetSeconds: number;
  overrides: VoiceOverrides;
}

const voices: SemanticVoice[] = ['main', 'response', 'leftHand', 'ignore'];
const pitchName = (pitch: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export function createPianoCalibration(video: HTMLVideoElement, renderer: ScoreRenderController, score: CalibrationScore): () => void {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('calibratePiano') !== '1') return () => {};
  let notes = score.notes;
  const overrides = { ...score.overrides };
  const panel = document.createElement('aside');
  panel.className = 'piano-calibration';
  panel.innerHTML = `
    <header><strong>PIANO · MIDI CALIBRATION</strong><button data-action="close" aria-label="Close">×</button></header>
    <div class="piano-calibration-meta" data-role="status"></div>
    <div class="piano-calibration-seek"><input data-role="seek" type="number" min="0" step="0.001" aria-label="MP4 time in seconds"><button data-action="seek">Seek</button><button data-action="minus">−0.1s</button><button data-action="plus">+0.1s</button></div>
    <div class="piano-calibration-voices"></div>
    <div class="piano-calibration-list" data-role="nearby"></div>
    <button data-action="export">Export voice overrides JSON</button>
    <p>Assignments are saved locally. Export the JSON to commit reviewed corrections separately from the MIDI.</p>`;
  document.body.appendChild(panel);
  const seek = panel.querySelector('[data-role="seek"]') as HTMLInputElement;
  const status = panel.querySelector('[data-role="status"]') as HTMLElement;
  const nearby = panel.querySelector('[data-role="nearby"]') as HTMLElement;
  const voiceRow = panel.querySelector('.piano-calibration-voices') as HTMLElement;
  for (const voice of voices.filter(voice => voice !== 'ignore')) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => renderer.setVoiceVisible(voice, input.checked));
    label.appendChild(input);
    label.appendChild(document.createTextNode(voice));
    voiceRow.appendChild(label);
  }
  const auditionVoices = new Set<SemanticVoice>();
  let audio: AudioContext | null = null;
  const sounding = new Map<string, { oscillator: OscillatorNode; gain: GainNode }>();
  const silence = () => { for (const sound of sounding.values()) { sound.oscillator.stop(); sound.oscillator.disconnect(); sound.gain.disconnect(); } sounding.clear(); };
  const auditionRow = document.createElement('div');
  auditionRow.className = 'piano-calibration-voices';
  auditionRow.textContent = 'Synth audition: ';
  for (const voice of voices.filter(v => v !== 'ignore')) {
    const label = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.addEventListener('change', async () => {
      if (toggle.checked) { auditionVoices.add(voice); audio ||= new AudioContext(); await audio.resume(); }
      else auditionVoices.delete(voice);
      silence();
    });
    label.appendChild(toggle); label.appendChild(document.createTextNode(voice)); auditionRow.appendChild(label);
  }
  voiceRow.parentNode?.insertBefore(auditionRow, voiceRow.nextSibling);
  const audition = () => {
    if (!audio) return;
    const active = notes.filter(n => !video.paused && auditionVoices.has(n.semanticVoice) && n.mediaStartTime <= video.currentTime && n.mediaSoundingEndTime > video.currentTime);
    for (const [id, sound] of sounding) if (!active.some(n => n.id === id)) { sound.oscillator.stop(); sound.oscillator.disconnect(); sound.gain.disconnect(); sounding.delete(id); }
    for (const note of active) if (!sounding.has(note.id)) {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
      gain.gain.value = .045 * note.velocity / 127;
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); sounding.set(note.id, { oscillator, gain });
    }
  };
  let lastCenter = -Infinity;
  let animation = 0;
  const update = () => {
    const time = video.currentTime;
    audition();
    const nearest = notes.reduce((best, note) => Math.abs(note.mediaStartTime - time) < Math.abs(best.mediaStartTime - time) ? note : best, notes[0]);
    const notation = score.notation.find(event => event.performanceId === nearest?.id);
    const scorePosition = notation ? `bar ${notation.measure + 1}, beat ${(notation.beat + 1).toFixed(2)} (engraving); MIDI tick ${nearest.startTick}` : '—';
    const pedal = score.pedals.some(p => p.startTime + score.mediaOffsetSeconds <= time && time < p.endTime + score.mediaOffsetSeconds);
    status.textContent = `MP4 ${time.toFixed(3)} s · score ${scorePosition} · offset ${score.mediaOffsetSeconds.toFixed(3)} s · pedal ${pedal ? 'down' : 'up'}`;
    if (document.activeElement !== seek) seek.value = time.toFixed(3);
    if (Math.abs(time - lastCenter) > .18 && !nearby.contains(document.activeElement)) {
      lastCenter = time;
      const selected = notes.filter(n => n.mediaStartTime >= time - .85 && n.mediaStartTime <= time + 1.25)
        .sort((a, b) => a.mediaStartTime - b.mediaStartTime || b.pitch - a.pitch).slice(0, 42);
      nearby.replaceChildren(...selected.map(note => {
        const row = document.createElement('div');
        row.className = `piano-calibration-note${note.confidence < .75 ? ' uncertain' : ''}`;
        row.dataset.noteId = note.id;
        const info = document.createElement('span');
        info.textContent = `${note.id} ${pitchName(note.pitch)} v${note.velocity} · ${note.mediaStartTime.toFixed(3)}–${note.mediaEndTime.toFixed(3)} s${note.mediaSoundingEndTime > note.mediaEndTime + .001 ? ` (pedal to ${note.mediaSoundingEndTime.toFixed(3)})` : ''} · ${note.provenance} ${Math.round(note.confidence * 100)}% · ${note.reason}`;
        const select = document.createElement('select');
        for (const voice of voices) {
          const option = document.createElement('option');
          option.value = voice;
          option.textContent = voice;
          option.selected = voice === note.semanticVoice;
          select.appendChild(option);
        }
        select.setAttribute('aria-label', `Voice for ${note.id}`);
        select.addEventListener('change', () => {
          overrides[note.id] = select.value as SemanticVoice;
          saveDevelopmentOverrides(overrides);
          notes = classifyMidiNotes(notes, overrides, score.mediaOffsetSeconds);
          renderer.setNotes(notes);
          lastCenter = -Infinity;
          // The existing RAF will refresh the panel; do not start a second loop.
        });
        row.appendChild(info);
        row.appendChild(select);
        return row;
      }));
    }
    animation = requestAnimationFrame(update);
  };
  const onClick = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') { panel.hidden = true; auditionVoices.clear(); silence(); }
    if (action === 'seek') video.currentTime = Math.max(0, Number(seek.value) || 0);
    if (action === 'minus') video.currentTime = Math.max(0, video.currentTime - .1);
    if (action === 'plus') video.currentTime += .1;
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(overrides, null, 2) + '\n'], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'itsumo-voice-overrides.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  };
  panel.addEventListener('click', onClick);
  const onSeekKey = (event: KeyboardEvent) => { if (event.key === 'Enter') video.currentTime = Math.max(0, Number(seek.value) || 0); };
  seek.addEventListener('keydown', onSeekKey);
  update();
  return () => { cancelAnimationFrame(animation); silence(); void audio?.close(); panel.removeEventListener('click', onClick); seek.removeEventListener('keydown', onSeekKey); panel.remove(); };
}
