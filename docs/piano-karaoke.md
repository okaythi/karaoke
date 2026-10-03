# Piano karaoke scores

A song shows a score under its video when `src/data/score/<song-id>/score.json` exists. Everything about engraving lives in the song-agnostic notation engine (`src/notation`, specified in [09-notation-engine.md](./09-notation-engine.md)); a song folder holds only data.

## A song's folder

| File | What it is |
| :--- | :--- |
| `song.json` | Where the source is, and the import settings: staves, meter, key, chord and roll detection, hand reach, tie threshold, octave-line thresholds, tempo-mark thresholds, and reviewed source **corrections** (per source note, each with a reason). |
| `source/` | The source itself. For いつも何度でも: a Transkun transcription of the recording aligned to a purchased MuseScore reference (`karaoke-map.json`). |
| `score.generated.json` | The import's output. Never edited by hand. |
| `edits.json` | Reviewed notation choices on top of the import (octave lines, cross-staff notes, tuplet sides…), each with a reason. |
| `score.json` | `score.generated.json` with the edits applied; what the site loads. |
| `timing.json` | When every note sounds in the recording, and the performed beat clock. |
| `style.json` | Glide and played colours (rose for the right hand, teal for the left in いつも何度でも). |

Rebuild after changing anything: `npm run import:score -- itsumo-nando-demo`. An edit whose target no longer exists fails the import instead of disappearing silently.

## Timing

The video's `currentTime` is the only clock. A note's glide starts at its recorded attack (a tied continuation starts when its beat arrives) and lasts its written value at the local performed tempo, read from the beat clock. A note stays lit for as long as it sounds; then it takes its played colour.

## Import

`src/notation/import/aligned.ts` turns aligned notes into notation with general rules: rolled chords become one chord with an arpeggio, near-simultaneous attacks merge (both hands share a position), a note out of one hand's reach joins the other hand's chord, each beat is read in sixteenths or in triplets when the onsets demand it, a lone inner-voice note becomes voice 2, and notes last to the next onset unless their sound clearly stopped, with ties only while a note still sounds over a barline. Clef changes (`import/clefs.ts`), octave lines (`import/ottavas.ts`) and rit./a tempo/fermatas (`import/tempo.ts`) are inferred from the notes and the performance. The left hand changes to treble clef where it stays above the bass staff (§7.9 of the engine spec) and takes no octave lines. An octave line covers whole figures (it never starts or stops inside a run) and never a chord it would push onto more ledger lines; see §7.8 of the engine spec.

## Review

`/admin/score-review?song=<id>&width=100&from=80&to=90` (development) shows a song engraved line by line, with inferred elements in brass and edited ones in green. `/admin/notation-gallery` shows every notation the engine knows.
