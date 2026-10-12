# Ensemble lyrics and character timing

The upload dialog still uploads one final video. Select the uploaded track, open **Raw / LRC**, and load the Swedish Bruno draft or paste/import a `.txt`, `.lrc`, or exported lyric `.json` file.

The import file is `src/data/lyric-drafts/vi-pratar-inte-om-bruno.sv.txt`. It contains the supplied Swedish lyrics with corrected named-part assignments and the finale's missing Dolores/Isabela reprise passages. It has been compared with the [attributed Swedish transcript](https://lyricstranslate.com/de/encanto-ost-vi-pratar-inte-om-bruno-we-dont-talk-about-bruno-lyrics.html), the [English part breakdown](https://movies.supertran.net/2021/12/encanto-2021.html), and frames from the user's copy of the [official Swedish video](https://www.youtube.com/watch?v=zVrLyU9YHpE).

This remains **source-checked rather than audio-certified**: audio input is unavailable in the assistant session and the official upload has no available transcript. The import preview states this limit. `Kör` represents group responses whose individual voice membership cannot be certified here. The named main chorus following Camilo is assigned to Pepa/Félix/Camilo, with Dolores's separate echo. The opening is Pepa alone, the boyfriend announcement is Camilo, and the final “Han är här!” belongs to the ensemble. The file groups each voice's finale passage together, rather than pretending that those passages are sequential. Timings establish the overlap.

## Import format

```text
// Comments do not become lyrics.
@Character A | #edd18e
A short phrase
Another phrase

@Character B | #8fd5f4
A response

@Character A + Character B
Identical words sung at identical times

@-
A phrase whose assignment you will choose later
```

A header assigns every following phrase until the next header. Character names are case-insensitive and Unicode-normalized for matching. Colours are optional six-digit hex values. Define colours on individual headers. Shared headers assign one timing to all listed singers; different words or timing must be separate phrases. Ordinary text, LRC line timestamps, and Japanese ruby syntax continue to work. Headers/comments are removed before tokenization. Review comments starting `// REVIEW:` appear in the import preview. Text imports start with untimed words; LRC retains phrase-level start estimates.

On wide studio layouts, importing character parts folds the Inspector to leave more room for the video; its button reopens it. The timeline overview scrolls after three lanes.

The preview reports phrase counts, characters, unassigned phrases and review notes. Applying an import replaces existing lyric/timing data after the existing-data confirmation. A saved JSON imports lyrics, character colours and global offset, retaining explicit word endings. It does not replace the selected track's media or identity.

## Assign and sync

1. Create any missing character with **+ Character**. In **All parts**, expand a phrase's assignment and check its character. Multiple checks mean shared words with shared timing. No checked character means Unassigned.
2. Keep **Show parts → All parts** to see the arrangement. Click a word, a phrase background, or its **Time** button to record that singer. **Record voice** chooses the recording target independently of the view filter. Keys **1–9** switch to the corresponding first nine characters without moving the video clock. You can also filter **Show parts** to one character; choosing a single filter selects that recording voice. An ensemble does not record until a voice is chosen. A shared phrase stays on the current recording voice when that voice belongs to it.
3. Set **Loop start/end** in video seconds. Select the first word to time for that passage, then enable **Loop section**. Clicking another word changes the starting cursor for that character's pass.
4. Focus the matrix (click a word). Press **K** to play and **Space** at each word's onset. Space advances through only the recording voice, skipping interleaved phrases from other singers. Each voice retains its own cursor, even in the full overview. Switching by clicking during playback does not seek the video. Repeated held key events are ignored.
5. Press **E** at the end of the last tapped word, especially for held final notes and gaps. Clicking a particular word first makes E apply to that word instead. Explicit endings are locked against automatic estimates.
6. **Restart pass** returns both video and cursor to the section start. Automatic looping also restores the pass cursor. Switch character and choose their first phrase to record the next voice; previous tracks remain intact.
7. Click a word to edit its **Word start/end** seconds, then Apply. `[`/`]` moves the selected word's entire timing by 50 ms.
8. Preview all voices, then Save or Export JSON. Headers/names are visible only in the editor; playback contains coloured words and segmented underlines for shared parts.

## Playback and data

Lyric files and save payloads may include `parts: [{ id, name, color }]`. A phrase uses the existing `speaker` or a `speakers` array for shared words. Words may include `timed` (explicit false means an untimed import, so real 0:00 starts work) and `endLocked` (preserve an explicit ending). Files without these fields still load.

The ensemble renderer retains every active phrase. Overlapping passages allocate stable slots; simultaneous phrases from the same character also get separate slots. Columns respond to the available lyric-container width, and the dock grows to fit the rows beneath the video. One video clock drives all word wipes. Word DOM is mounted only when phrases change; playback frame work stops while paused. Individual timing taps update the affected phrase, cursor controls and existing timeline blocks in place. They do not replace the lyric matrix, recreate the preview or recalculate every phrase's endpoints. Matrix playback indicators update at 10 Hz; lyric wipes retain the playback frame rate. Assignment checkboxes are created when their menu is opened.

Saving estimates missing ends within their own phrase. It never uses the next character's entrance as an ending. Colour definitions and references are validated by the shared save contract used by both save destinations.

## Lightweight validation

```sh
node --import tsx --test src/core/tests/ensemble.test.ts src/studio/tests/recording.test.ts src/player/tests/*.test.ts
node --max-old-space-size=384 node_modules/typescript/bin/tsc --noEmit --strict --allowJs --skipLibCheck --target esnext --module esnext --moduleResolution bundler --types astro/client,node src/studio/index.ts src/player/karaokePlayer.ts src/core/contracts.ts
```

Use the local Astro development preview for UI checks. This feature does not require video encoding, waveform generation, an audio-separation model or additional media streams.
