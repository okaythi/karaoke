# Itsumo Nando Demo piano karaoke

The existing R2 MP4 is the only playback medium and its `<video>.currentTime` is the runtime clock. The source `itsumo-transcribed.mid` is ignored by Git and must remain unchanged. The checked-in `src/data/score/itsumo-midi.json` is a deterministic extraction of the MIDI's 1,711 paired notes and 140 sustain-pedal intervals. It preserves MIDI pitch, velocity, channel, onset/offset ticks, onset/offset seconds, and a pedal-aware sounding end. The transcription contains one note track and one channel, so semantic voices are inferred rather than read from tracks.

## Timing

`src/data/score/itsumo-midi-config.json` records an explicit zero-second media offset. Read-only attack comparisons between the existing MP4 audio and MIDI at 2.453, 36.159, 39.068, 48.240, 51.196, 90.377, 93.260, 102.356, and 105.284 seconds found no material fixed offset or drift. The import uses MIDI's tempo event only to turn its ticks into seconds; the renderer never uses BPM, a tempo map, score anchors, or an animation clock. Every frame recomputes note progress from the video element's current time. Seeking and pausing cannot accumulate drift.

## Import and corrections

Install `scripts/requirements-piano.txt` into a Python environment and run `python3 scripts/import-transkun-midi.py` to regenerate the performance JSON from the source MIDI. Run `python3 scripts/derive-piano-notation.py` to regenerate the separate notation draft. The source MIDI and MP4 remain untouched. Voice classification lives in `src/score/classify.ts`, with confidence, reason, and automatic/manual provenance. The four assignments are `main`, `response`, `leftHand`, and `ignore`. `src/data/score/itsumo-voice-overrides.json` is a separate, reviewed correction layer keyed by stable MIDI note IDs.

For development, use `npm run dev` and `?song=itsumo-nando-demo&calibratePiano=1`. The panel shows exact MP4 time, engraved bar/beat position and source MIDI tick, nearby pitches, velocity, voice, confidence, provenance, note start/end, pedal-extended sounding end, and pedal state. Seek with a millisecond-entry field or 100 ms steps. Toggle the three voices visually or audition them independently with the development synthesizer, which reads the same MP4 clock. Changing an assignment saves a local draft; export the JSON and replace `itsumo-voice-overrides.json` when reviewed. The panel is excluded from production builds.

## Engraving and glide

The two data layers are separate. `itsumo-midi.json` stores the exact performance events and timestamps. `itsumo-notation.json` stores a sixteenth-note score grid in **3/4**, conventional duration symbols, measure/beat positions, and the corresponding `performanceId`. `scripts/derive-piano-notation.py` generates the notation draft from lower-register pulse attacks and source event onsets/releases. Its beat grid is only an engraving aid. The runtime never uses that grid to compute playback progress. Every rendered event looks up its original MIDI note ID and uses its unquantized MP4 onset/sounding-end times for its orange glide.

The key signature is E major's **four sharps: F♯, C♯, G♯, D♯**, as specified for this arrangement. The transcription MIDI's 4/4 metadata is ignored for engraving. VexFlow supplies clefs, staff lines, barlines, noteheads, stems, flags, beams, rests, accidentals, dots, ties, and ledger lines. The app chooses the visible measures, staff hierarchy, spacing, SVG colors, and orange notehead wipe. Short values are beamed within 3/4 beats. The notation stays fixed while each sounding MIDI event has an independent clip width. Chord pitches share an engraved group when their quantized onset and duration agree.

The generated notation is a **draft**: automatic beat tracking, rhythmic spelling, and main/response/leftHand classification still need musician review. Score metadata and performance events can be corrected independently. The current calibration panel handles voice corrections; `itsumo-notation-overrides.json` stores reviewed score positions, durations, and enharmonic spellings by performance ID, separate from both generated files and MIDI timing.
