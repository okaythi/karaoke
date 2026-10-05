# Fantaisie-Impromptu, Op. 66

Song ID: `chopin-fantaisie-impromptu`.

The reference contains all 138 bars, 3,049 written notes, key
changes at bars 41 and 83, simultaneous sixteenths/triplets, 7:4 tuplets, grace
notes, ties, cross-staff voices, slurs, dynamics, pedals and octave lines. The
runtime loads this piece through the existing song-agnostic notation engine.
The full recording also includes a closing passage after the reference's
held chord. The runtime score has 148 bars and 3,132 noteheads, including a
pause bar, 82 recorded closing attacks and one tied continuation.

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
note's recorded release. The sequence matcher stops at the engraved
reference's final chord. This is not the end of the full recording:
`source/closing-passage.json` retains all 82 subsequent attacks from the
performance MIDI. The importer appends that passage after a pause bar and
ends at the MP4's 363.279583-second endpoint. Closing pitches and onset/release
times come from the existing transcription; rhythm follows the phrase beat
groups in `preparation.closingPassage`,
including a half-bar pickup and a two-flat signature with explicit F-sharp
and C-sharp spelling. Timing still follows the actual rubato; slowing down
does not create extra written beats. Hand assignment uses register. These
elements carry
`recorded-closing-passage` inferred provenance and are not attributed to the
Mutopia edition. No new audio inference is required.

## Current verification and review

- All 148 runtime bars validate with zero warnings/errors.
- All 3,132 runtime noteheads have finite, ordered timing intervals.
- The 3,014 distinct score attacks agree with the reference MIDI's pitch counts.
- 2,981 of 3,035 written attacks (98.2%) map to detected performed attacks,
  including 21 shared-key unisons. The remaining 54 use interpolated timing.
- The first recorded attack is at 5.097396 seconds. Leading silence is retained.
- The reference's final chord attacks at approximately 334.17–334.93 seconds.
  Its original reference alignment endpoint is 340.160417 seconds. The full
  score retains those timings, includes the 82 later attacks starting at
  345.5 seconds, and follows the recording through 363.279583 seconds.
  The original MP3 lasts 363.252971 seconds; the MP4 container lasts 363.279583.
- Regression tests cover the polyrhythm, key changes, grace and cross-staff
  notation, septuplets, preserved reference timings, every closing attack,
  the full recording endpoint, full timing coverage,
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
and lasts 363.252993 seconds. The reference timings and `globalOffset: 0`
apply; the appended closing passage retains its original recorded attacks.

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

## Protected public playback (2026-10-05)

Fantaisie remains publicly playable. Production first runs the dedicated
**Invisible** Turnstile widget automatically, then POSTs its single-use token
to `/api/karaoke/protected/session`. The server validates with Cloudflare
Siteverify, checking success, the allowed deployment hostname and the
`fantaisie_playback` action. Missing configuration, network failures and
invalid tokens deny playback. No video URL is assigned before verification.
Browser autoplay policy still applies after asynchronous verification.

The server grants a 15-minute HMAC credential in a `Secure`, `HttpOnly`,
`SameSite=Strict`, host-only cookie. It is scoped to this song and bound to the
browser's user agent. Active playback renews it with a new Turnstile token.
The video and arrangement APIs check it on every request, reject cross-site
browser requests and navigations, and return private/no-store headers without
CORS permission. The MP4 is streamed from private R2, with single-range and
HEAD support for seeking. There is no fallback to the public bucket.

- Private bucket: `karaoke-protected`, binding `PROTECTED_MEDIA_BUCKET`.
- MP4: the manifest's unchanged filename, in that private bucket.
- Rendering inputs: `fantaisie/runtime-score.json`.
- Original source archive: `fantaisie/private-sources.tar`.
- Public setting: `TURNSTILE_SITE_KEY`; hostname allowlist `PLAYBACK_HOSTNAMES`.
- Pages secrets: `TURNSTILE_SECRET_KEY`, `PLAYBACK_SIGNING_SECRET`.

Neither a custom public domain nor managed `r2.dev` access may be enabled on
this bucket. Keep source copies locally in the now-ignored song folder.
The public repository does not need them to build. To review this song locally,
restore the private source archive and use Pages Functions with real configured
credentials (or Cloudflare's documented test keys in a local-only environment);
a plain Astro static preview does not provide the protected endpoints.
The old development MP4 URL override is only a local recording preview; it
does not bypass protected production playback or provide a score endpoint.

`npm run test:security` checks grant integrity, expiration, origin enforcement,
private-only reads, range handling and Turnstile validation. The deployment
script runs `verify:protected-build` to reject accidental source/media leakage
into static files. Private notation fixtures are tested when present locally
and skipped in a source-free checkout.

### Security boundary and release checklist

Turnstile and signed cookies are automation/access controls, **not DRM**. A
viewer who passes verification receives MP4 bytes and score rendering inputs
and can save them. JavaScript obfuscation, disabled context menus and hiding
controls do not change that fact. This implementation does not claim to make
extraction impossible, to prevent recordings, or to revoke copies already
obtained. True media extraction resistance requires licensed DRM packaging,
a license server and an EME player; visible notation remains reproducible.

Before considering migration complete:

1. Verify the private object matches the original size and hash.
2. Deploy and verify denied anonymous direct requests plus real browser playback.
3. Remove the old public MP4 and purge every configured public CDN alias/cache.
4. Remove source files from current public Git branches **and their history**;
   review/approve the history rewrite separately. GitHub forks, cached blobs
   and existing clones may require additional GitHub support action.
5. Remove or restrict historical Pages deployments containing the old score
   chunks. Deleting a current asset does not revoke immutable deployments.
6. Keep Cloudflare/GitHub administrative access restricted. Apply edge rate
   limits to session issuance and media requests if abuse warrants them.

Cloudflare documents [Invisible widgets](https://developers.cloudflare.com/turnstile/concepts/widget/),
[mandatory server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
and [R2 public access](https://developers.cloudflare.com/r2/buckets/public-buckets/).

### Migration verification

The private MP4 was verified as 113,817,657 bytes with ETag/MD5
`9403cf165542eefde5bd53a3ba290ffe`, matching the original. The user confirmed
protected video playback and the moving score after the explicit Turnstile
loader correction. Loading now uses a brass CSS spinner of diameter `2.443cm`
with a screen-reader label; CSS physical units do not calibrate real monitors.
The unsolicited header Privacy link was removed; `/privacy` retains the
Turnstile disclosure and is referenced through `rel=privacy-policy` metadata.

The public video object was deleted. A dedicated Worker now returns 410 for
its retired CDN path before any origin/cache fetch, including encoded and
normalized variants. The route is `cdn.sudothy.me/Fr*`; other files matching
that prefix pass through. Deploy it with `npm run deploy:origin-guard`.
The cache-purge API denied the OAuth token, so this guard is the actual
verified protection for the former CDN URL; no cache purge is claimed.

Both public Git branches were rewritten with only the protected source and
original-media directories removed from their historical trees. Other
historical content was preserved. The current public branch no longer serves
the score source. Original local history remains under private backup refs;
never push those refs or mirror this local repository publicly.

The three exposed historical Pages deployments were deleted through the API.
Cloudflare still served their cached assets afterward, so their hostname
aliases were retired with tiny Pages Workers that return 410 on every path:
`ba23e68d`, `b29a1202` and `5cdc45e9` under `karaoke-7n0.pages.dev`.
Keep those retirement deployments; ordinary production playback is separate.

GitHub still served a known old commit's score after the history rewrite.
This remaining provider-side retention requires GitHub support cleanup.
Rewriting branch history does not promise erasure of cached/unreachable
commits or copies already obtained. A local support-request draft was prepared;
no support message was sent.
