# Itsumo engraving regression source

`itsumo-bars-9-12.musicxml` is an unchanged extraction of measures 9–12 from
`src/data/score/itsumo-final.musicxml`. Keep it aligned with the source score
when revising that score.

Expected notation in these four measures:

| Bar | Upper staff | Lower staff |
| --- | --- | --- |
| 9 | Two quarters, a 32nd/eighth-rest/32nd triplet, an eighth | One quarter, then two quarter-note chords |
| 10 | Two quarters, two beamed eighths | One quarter, then two quarter-note chords |
| 11 | One quarter, four eighths in two beat groups | One quarter, then two quarter-note chords |
| 12 | One half, two beamed eighths | One quarter, then two quarter-note chords |

The source has no dots or octave-shift directions in bars 9–12. For those
symbols, inspect bar 19 (dotted eighth) and a synthetic MusicXML octave-shift
case; the complete source score currently contains no octave-shift direction.
