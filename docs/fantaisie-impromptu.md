# Fantaisie-Impromptu, Op. 66

Song ID: `chopin-fantaisie-impromptu`.

The local implementation contains all 138 bars, 3,049 written notes, key
changes at bars 41 and 83, simultaneous sixteenths/triplets, 7:4 tuplets, grace
notes, ties, cross-staff voices, slurs, dynamics, pedals and octave lines. The
runtime loads this piece through the existing song-agnostic notation engine.

## Sources

- Timing authority: `Fantaisie-impromptu op 66/fantaisie impromptu - autoritative.mp3`.
- Performance transcription: `fantaisie-transkun.mid`, copied to `source/performance.mid`.
- Reference MIDI: `chopin_fantaisie-impromptu.mid`, copied to `source/reference.mid`.
- Written notation: [Mutopia-2009/09/05-1693](https://www.mutopiaproject.org/ftp/ChopinFF/O66/chopin_fantaisie-impromptu/),
  Herrmann Scholtz edition, typeset by Guy D. Lederfein and released into the
  public domain. Mutopia's MIDI is byte-for-byte identical to the supplied MIDI.
  `source/reference.ly` preserves that original source.
- The supplied ten-page PDF is retained in the original asset folder as a
  visual reference. The imported notation uses the original LilyPond source,
  including expression/voice information that is absent from MIDI. Do not
  assume its editorial markings are identical to the PDF's MIDI-derived ones.

`source/reference.converted.ly` contains the music definitions converted with
LilyPond 2.24.4's `convert-ly`. Its score wrapper was removed for export; obsolete
automatic-beam configuration was removed; two TextSpanner text overrides were
updated to `bound-details.left.text`. No pitch or duration edits were made.

## Rebuild

Ordinary builds use the checked-in score/timing JSON and need no LilyPond or
Python dependencies. To regenerate the music tree, use LilyPond 2.24.4:

```bash
python3 scripts/notation/export-lilypond.py chopin-fantaisie-impromptu
```

The optional `--executable` flag selects an existing LilyPond executable.
LilyPond resolves the source language; `export-lilypond.scm` exports exact
semantic music properties. The Python adapter supports the music constructs
used in this 4/4 piano source and fails on unsupported musical events.
It discards drawing overrides so the Theater owns layout.

Install the alignment dependencies in a virtual environment using
`scripts/notation/requirements.txt`, then run:

```bash
python3 scripts/notation/align-score.py chopin-fantaisie-impromptu
npm run import:score -- chopin-fantaisie-impromptu
```

The first command writes prepared source score/timing data and
`alignment-report.json`. The second validates the prepared data, applies
`edits.json`, and writes the three runtime score files. The report records
source SHA-256 hashes, unresolved attack IDs, their bars, and predicted times.

The alignment uses a pitch-sequence match, followed by nearby same-pitch
recovery within 85 ms. A monotonic clock interpolates unmatched attacks.
Coincident unisons in separate voices share a physical performed attack;
grace notes remain independent attacks. Tied continuations use the original
note's recorded release. The sequence matcher does not force the final chord
to match unrelated notes later in the audio.

## Current verification and review

- All 138 bars validate with zero warnings/errors.
- All 3,049 written notes have finite, ordered timing intervals.
- The 3,014 distinct score attacks agree with the reference MIDI's pitch counts.
- 2,981 of 3,035 written attacks (98.2%) map to detected performed attacks,
  including 21 shared-key unisons. The remaining 54 use interpolated timing.
- The first recorded attack is at 5.097396 seconds. Leading silence is retained.
- The final chord attacks at approximately 334.17–334.93 seconds and releases
  by 340.160417 seconds. The original MP3 lasts 363.252971 seconds and includes
  82 detected later notes that are excluded from this piece's alignment.
- Regression tests cover the polyrhythm, key changes, grace and cross-staff
  notation, septuplets, final-chord/outro matching, full timing coverage,
  monotonic beats, and finite engraving at narrow/wide widths.
- Browser state checks confirm MP3 loading, bar seeking, automatic score
  following and the two-panel portrait layout without horizontal overflow.
  Screenshot capture was unavailable in the in-app browser; visual collision
  review remains part of the release review.

Review in development at `/admin/score-review?song=chopin-fantaisie-impromptu`.
For a local audio preview, append an `audio` query parameter containing the
URL-encoded `/@fs/` absolute path to the original MP3. That parameter is
development-only and does not copy the MP3 into the build. `from`, `to` and
`width` control the sheet review. Brass noteheads identify interpolated times;
the review buttons seek to one second before each flagged passage.

The interpolation list is an explicit review queue, not a claim that those
written notes are wrong or omitted in the recording. A transcription can miss
notes. Inspect the original recording before making musical corrections.

## Final MP4 and release

The supplied local MP4 is
`Fantaisie-impromptu op 66/fantaisie-tokyo-ghoul-final-720p.mp4`.
The user confirms that it contains the exact authoritative MP3 on its original
timeline. Its streams are H.264 1280×720 and stereo AAC; audio starts at zero
and lasts 363.252993 seconds. Existing timings and `globalOffset: 0` apply.

For a preview in the actual public player's layout, run the development server
and open `/?song=chopin-fantaisie-impromptu&preview=fantaisie`. The development-only
override serves this local MP4 directly, without copying or re-encoding it.
It also makes the pending song selectable while its CDN object is absent.
The production player continues to use the catalog's CDN filename.

The manifest is
prepared for this exact, case-sensitive object key:

`Frédéric Chopin - Fantaisie-Impromptu, Op. 66.mp4`

Keep the original audio start, including its leading silence and trailing
material. Do not trim, prepend silence, change playback speed, or shift audio
relative to the MP4's media clock. The current `globalOffset` is zero. If the
video is exported under a different name, update both the manifest and the
song's `media.videoFile` metadata before upload.

Review the MP4 with the moving score, especially the first attack, bars 41/83
and the final chord. Upload the final MP4
to the existing R2/CDN path, resolve the release review queue, build, and deploy
the score bundle together. No separate MP3 upload or audio-only public player
is required.

On 2026-10-03 the supplied MP4 was uploaded to `gewoonthy-media` under the
manifest's exact filename. The CDN returns HTTP 200, `video/mp4`,
113,817,657 bytes and ETag `9403cf165542eefde5bd53a3ba290ffe`, matching the
local file's MD5. The score bundle still awaits release review and deployment.
