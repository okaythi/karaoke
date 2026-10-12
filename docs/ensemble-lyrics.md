# Ensemble lyrics and character timing

The upload dialog still uploads one final video. Select the uploaded track, open **Raw / LRC**, and load the Swedish Bruno draft or paste/import a `.txt`, `.lrc`, or exported lyric `.json` file.

The draft is `src/data/lyric-drafts/vi-pratar-inte-om-bruno.sv.txt`. It reformats the lyrics supplied in this chat, splitting parenthetical responses into separately assigned phrases. Its 93 phrases and 11 parts are **not an audio-verified, complete transcription**. The official reference is https://www.youtube.com/watch?v=zVrLyU9YHpE. Review notes identify uncertain group assignments and the absent independent Isabela/Dolores finale text. No absent Swedish lyrics were invented.

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
2. Choose **Time this part**. The matrix and timeline filter to this character, and Space/Tab/Backspace stay on this character's track. A shared phrase is the same phrase when accessed from either character.
3. Set **Loop start/end** in video seconds. Select the first word to time for that passage, then enable **Loop section**. Clicking another word changes the starting cursor for that character's pass.
4. Focus the matrix (click a word). Press **K** to play and **Space** at each word's onset. Space advances through only the selected part. Repeated held key events are ignored.
5. Press **E** at the end of the last tapped word, especially for held final notes and gaps. Clicking a particular word first makes E apply to that word instead. Explicit endings are locked against automatic estimates.
6. **Restart pass** returns both video and cursor to the section start. Automatic looping also restores the pass cursor. Switch character and choose their first phrase to record the next voice; previous tracks remain intact.
7. Click a word to edit its **Word start/end** seconds, then Apply. `[`/`]` moves the selected word's entire timing by 50 ms.
8. Preview all voices, then Save or Export JSON. Headers/names are visible only in the editor; playback contains coloured words and segmented underlines for shared parts.

## Playback and data

Lyric files and save payloads may include `parts: [{ id, name, color }]`. A phrase uses the existing `speaker` or a `speakers` array for shared words. Words may include `timed` (explicit false means an untimed import, so real 0:00 starts work) and `endLocked` (preserve an explicit ending). Files without these fields still load.

The ensemble renderer retains every active phrase. Overlapping passages allocate stable slots; simultaneous phrases from the same character also get separate slots. Columns respond to the available lyric-container width, and the dock grows to fit the rows beneath the video. One video clock drives all word wipes. Word DOM is mounted only when phrases change; playback frame work stops while paused.

Saving estimates missing ends within their own phrase. It never uses the next character's entrance as an ending. Colour definitions and references are validated by the shared save contract used by both save destinations.

## Lightweight validation

```sh
node --import tsx --test src/core/tests/ensemble.test.ts src/player/tests/*.test.ts
node --max-old-space-size=384 node_modules/typescript/bin/tsc --noEmit --strict --allowJs --skipLibCheck --target esnext --module esnext --moduleResolution bundler --types astro/client,node src/studio/index.ts src/player/karaokePlayer.ts src/core/contracts.ts
```

Use the local Astro development preview for UI checks. This feature does not require video encoding, waveform generation, an audio-separation model or additional media streams.
