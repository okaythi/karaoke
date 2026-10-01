# Itsumo engraving fixtures

The score shown to listeners is derived from `itsumo-karaoke-map.json` through
`engravingModel.ts`. The source note identity, sounding MIDI pitch, audio start,
audio end, measure, and staff stay in the source model. The generated MusicXML
is retained as evidence and is not used to choose display rhythm or voices.

`itsumo-bars-9-12.musicxml` is an unmodified extraction from the generated
MusicXML. It records the pathological mixed tuplet that motivated notation
normalisation; the displayed bar 9 uses ordinary eighth notes.

Reference captures from the deterministic fixture page:

| Range | Visual check | Capture |
| --- | --- | --- |
| 9–12 | Conventional quarters, half note, eighth beams, lower staff chords; no isolated mixed tuplet | [bars-9-12.png](bars-9-12.png) |
| 22–25 | Sustained generated 8va line and readable high-register chords | [bars-22-25.png](bars-22-25.png) |
| 45–48 | Auxiliary voice, cross-bar tie, chord displacement, and dotted chord | [bars-45-48.png](bars-45-48.png) |

For a fresh local capture, build and serve the site, then open
`/admin/engraving-fixture/?bars=9`, `?bars=22`, or `?bars=45`. Add `count=6`
to inspect the live six-bar density. `?scan=1&count=6` renders every live page
and reports source anchors, layout errors, and time-to-X reversals.
