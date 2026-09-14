# Tokenizer & NLP Pipeline

## 1. The Linguistic Tokenization Challenge

In western languages (Latin, Cyrillic), words are delimited by explicit whitespace (`\s+`). However, in non-segmented East Asian languages (specifically Japanese), sentences are written without spaces:

$$\text{日本語の歌詞：} \quad \text{「私[わたし]は歌う」}$$

If split naively on characters or spaces:
1. Multi-character kanji compounds with ruby furigana (like `私[わたし]`) would break into disjointed fragments.
2. Compound digraphs (拗音 like `きょ`, `しゃ`), geminate consonants (促音 like `っ`), and long vowels (長音 like `ー`) would be treated as independent characters, forcing the singer to tap multiple times for a single mora.
3. Isolated punctuation marks (`「`, `」`, `。`, `！`) would become independent timing chips, causing the sync operator to tap quotation marks instead of syllables.

To solve this, `src/lib/karaoke/naming.ts` implements a multi-pass, deterministic regular expression tokenizer and punctuation agglomeration engine.

---

## 2. Japanese / CJK Master Regular Expression

When the input line contains CJK characters (tested via `/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/`), the engine executes the following non-destructive token regex:

```typescript
const tokenRegex = /([\u4e00-\u9faf\u3400-\u4dbf]+)\[([\u3040-\u309f\u30a0-\u30ff]+)\]|([\u3040-\u309f\u30a0-\u30ff][ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]*)|([\u4e00-\u9faf\u3400-\u4dbf])|([^\s\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+)|([「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+)|(\s+)/gu;
```

### Match Groups Deconstructed

| Capture Group | Target Pattern | Description | Example Match | Resulting Token Structure |
|---|---|---|---|---|
| **Group 1 & 2** | `([\u4e00-\u9faf\u3400-\u4dbf]+)\[([\u3040-\u309f\u30a0-\u30ff]+)\]` | **Ruby Furigana Compound**: 1+ Kanji immediately followed by Kana in brackets | `祈[いの]り` or `私[わたし]` | `{ word: "祈", furigana: "いの" }` |
| **Group 3** | `([\u3040-\u309f\u30a0-\u30ff][ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]*)` | **Compound Kana Mora**: Standard Hiragana/Katakana followed by small kana modifiers or prolonged sound marks | `きょ`, `ちょっと`, `らー` | `{ word: "きょ", start: 0, end: 0 }` |
| **Group 4** | `([\u4e00-\u9faf\u3400-\u4dbf])` | **Standalone Kanji**: Single kanji without ruby annotations | `夢`, `愛` | `{ word: "夢", start: 0, end: 0 }` |
| **Group 5** | `([^...]+)` | **Latin / Alphanumeric Word**: Consecutive western tokens or symbols embedded in Japanese text | `OK`, `Baby`, `123` | `{ word: "Baby", start: 0, end: 0 }` |
| **Group 6** | `([「『...」』...]+)` | **Punctuation Sequence**: Full-width and half-width quotation marks, brackets, commas, periods | `「`, `」`, `!?`, `…` | Redirected to punctuation accumulator |
| **Group 7** | `(\s+)` | **Whitespace**: ASCII or full-width (`\u3000`) space | ` ` or `　` | Attached to previous token as delimiter |

---

## 3. Punctuation Agglomeration Algorithm (`cleanVersePunctuation`)

A major usability flaw in standard lyrics sync software is that quotation marks and punctuation marks appear as standalone interactive buttons. An operator would be forced to tap `Space` for `“`, then `Space` for `Hello`.

The Karaoke Engine eliminates standalone punctuation via an **asymmetric agglomeration algorithm**:

```
           [ Pure Punctuation Token ]
                       |
            Is it opening or closing?
            /                       \
   [ Opening Punctuation ]      [ Closing Punctuation ]
   (e.g. 「, 『, “, (, [)       (e.g. 」, 』, ”, ), !, ?, .)
            |                                |
  Accumulate into               Has a previous word
  pendingPrefix                 already been emitted?
  (Attaches to NEXT word)       /                   \
                              YES                    NO
                               |                      |
                        Append to               Accumulate into
                        previousWord.word       pendingPrefix
                        (extends word.end)
```

### Regular Expressions Used
- `OPENING_PUNCT_REGEX`: `/^[「『“‘"'(（【〔《〈［\[]+$/`
- `CLOSING_PUNCT_REGEX`: `/^[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;]+$/`
- `ALL_PUNCT_REGEX`: `/^[「『“‘"'(（【〔《〈［\[」』”’"')）】〕》〉］\]、。！？!?…・―—~〜,.:;\s]+$/`

### Code Implementation (`naming.ts`)
```typescript
export function cleanVersePunctuation(verses: Verse[]): Verse[] {
  verses.forEach(v => {
    if (!v.words || v.words.length === 0) return;

    const cleaned: Word[] = [];
    let pendingPrefix = '';

    for (let i = 0; i < v.words.length; i++) {
      const w = v.words[i];
      const trimmed = w.word.trim();

      if (ALL_PUNCT_REGEX.test(trimmed)) {
        if (OPENING_PUNCT_REGEX.test(trimmed)) {
          pendingPrefix += w.word;
        } else if (cleaned.length > 0) {
          const prev = cleaned[cleaned.length - 1];
          prev.word = prev.word.trimEnd() + w.word;
          if (w.end > prev.end) prev.end = w.end;
        } else {
          pendingPrefix += w.word;
        }
      } else {
        if (pendingPrefix) {
          w.word = pendingPrefix + w.word;
          pendingPrefix = '';
        }
        cleaned.push(w);
      }
    }

    if (pendingPrefix && cleaned.length > 0) {
      cleaned[cleaned.length - 1].word += pendingPrefix;
    }

    v.words = cleaned;
  });

  return verses;
}
```

---

## 4. LRC Import & Timecode Extraction

The ingestion pipeline natively supports standard `.lrc` lyrics files via `parseRawLyrics(rawText: string)`:

### LRC Timecode Matcher
```typescript
const isLrcLine = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\](.*)$/;
```

### Conversion Formula
For an LRC timestamp $[MM:SS.xxx]$:
$$\text{verseStart} = (MM \times 60) + SS.xxx$$

When an LRC line is detected:
1. `verseStart` is parsed into a floating point second timestamp rounded to 3 decimal places.
2. An initial estimation of `verseEnd` is provisioned as `verseStart + 2.0`.
3. The remaining text on the line is passed to the tokenizer to break it into individual words, ready for fine-grained spacebar synchronization.
