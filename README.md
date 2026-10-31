# Drizzlet Hygrostat

The Drizzlet Hygrostat: set your firmware's climate. (A hygrostat is the industrial humidity controller; this one controls drizzle.)

This standalone repository builds the Drizzlet Hygrostat page with Hugo and deploys it to GitHub Pages. Firmware lives in [insolentconstruct/eurorack, branch drizzlet](https://github.com/insolentconstruct/eurorack/tree/drizzlet); [firmware releases and update downloads](https://github.com/insolentconstruct/eurorack/releases) remain there.

A static page that makes the Beads firmware update file (`.wav`) in the browser, from a release's app image. Nothing is uploaded; no server or build step.

The profile editor targets profile-capable Beta 2 and later firmware. It offers
Off, Fixed and Adjustable features, defaults, page/amount/action placements,
templates, share links and desktop/phone SVG guides. Conflicts and invalid
firmware profiles are refused. Older plain-WAV releases are not offered.

Per-feature CPU costs are measured on a module-calibrated development board;
four event-only features have no per-block work by code inspection. Estimates
sum each engine's own costs. The synth baseline is the measured default-profile
worst case, **87.2% with Clouds-style reverb**, width 255 and Raag Shri; it already
includes Clouds-style reverb. Granular's historical baseline is 83.0% and
already includes its default settings too. Per-feature estimates subtract each
feature's default cost for both engines, so moving slots leaves both baselines
unchanged.

Measurement provenance: measured on the module, October 2026. Clouds-style
synth reverb ranged from 86.1–87.2%; Plaits with Clouds-style reverb measured
69.4%, and vanilla granular 92.1% supplies the provisional ceiling. These builds
predate profiles and paired grains; invalid boot-guard measurements are excluded.

A custom profile enabling any feature without a measured cost shows
“CPU cost not yet measured for: …” instead of a computed percentage. It does
not warn or block on unknown costs. The exact release default is always allowed.
Once all enabled features have measured costs, each engine rounds to 0.1%:
warn from 91% and block above the provisional 92% ceiling. Exact measured
combinations key on the complete encoded 512-byte profile
(`cpu.combinations[].profile`, hex). Missing engine measurements fall back to
that engine's baseline plus measured feature deltas; placement changes require
another exact match. Exact module measurements take precedence over per-feature estimates.

Before each release, check the final image's default profile and heaviest
supported combinations on the module. Historical baselines remain provisional;
module measurements take precedence over estimates.

Layout: everything served as-is is under `static/`, where a Hugo site expects it, so moving to Hugo later only adds configuration and templates. Tests are outside it.

- `static/js/profile.js`: wire-format parser/encoder, validation, templates,
  share links, fingerprints, names and CPU rules. Metadata mirrors
  `beads/profile.cc`; a differential test checks the real parser.
- `static/js/guide.js`: custom layout drawing, with knob-card geometry ported
  from `options_guide.py`. `release_guides.js` preserves the canonical release
  drawings for the untouched default. Update these two SVG strings when the
  release guides change. Normalisation removes only the added fingerprint
  `<text data-profile-fingerprint="true">` element: every remaining byte of
  the default guide must equal the release SVG. Edited layouts reuse the
  release's to-scale panel geometry and draw their own pages and gestures.
- `static/js/decoder.js`: generated-PCM QPSK demodulator, with packet headers,
  CRCs, descrambling and padding checks. This checks generated WAVs, not audio
  recorded from a player.
- `static/js/encoder.js`: Mutable Instruments' QPSK encoder (`stm_audio_bootloader/qpsk/encoder.py`) as Beads' release build runs it. One unminified module, used by both the page and the Node tests.
- `static/js/glibc_sincos.js`: sine and cosine ported from the GNU C Library 2.36, LGPL 2.1 or later (`static/js/COPYING.LIB`). The release file is encoded by numpy on glibc; one last bit of a sine decides between samples 32766 and 32767, and the browser's own `Math.sin` differs in about 636,000 samples of the Beta 2 file.
- `static/index.html`, `static/js/app.js`, `static/js/worker.js`: the page; encoding and decode-back verification run in a worker.
- `static/manifest.json` and `static/images/`: the releases offered, with each app image and update file pinned by SHA-256. GitHub release downloads cannot be fetched from another site, so the images are served with the page.

Running tests locally requires Node 18 or later, g++, and a firmware checkout
with full history, tags and its stmlib submodule. From this repository, clone
firmware into `./firmware` (the default), or clone it beside this repository and
set `FIRMWARE_REPO=../eurorack`:

```sh
git clone --branch drizzlet https://github.com/insolentconstruct/eurorack.git firmware
git -C firmware submodule update --init stmlib
```

Run from this repository's root:

```sh
node test/manifest.js
node test/profile.js
node test/downloads.js
node test/help.js
node test/readiness.js
node test/golden.js APP.bin EXPECTED_WAV_SHA256
```

`test/browser.mjs` adds every-feature Fixed/Off byte round trips and
same-document share-link regressions in Chromium, Firefox and WebKit. Run it
with Playwright available in an offline Docker container serving the page;
`SITE` names the static directory and `BASE` the local HTTP URL. Browser test
dependencies belong to the test harness and are never served by the page.

The profile test compiles a small oracle from the manifest source commit or release tag’s firmware parser and
compares more than 26,000 candidate blocks. The compiler uses stmlib from `FIRMWARE_REPO`. Firmware sources, catalogue and
documentation are read with `git -C` from the manifest's source commit or release
tag. When the pinned firmware is an ancestor of the firmware checkout's HEAD,
its working parser source and header must also match it byte for byte.

Manifest format 2 stores the profile offset, size, version, release ID and
feature table per release. `default_in_block: false` omits a feature from the
untouched wire block while its catalogue default remains available in the editor.
The 23-feature catalogue must match the pinned firmware file byte for byte and
is checked against its definition table. `FIRMWARE_CATALOGUE_REF` adds a second
byte-identity check against a prepared firmware revision. The default block still
contains 14 entries. `states` controls editor modes.
Released `release_id` values are the tag date as hexadecimal YYYYMMDD (for example,
2026-11-05 becomes `0x20261105`), and must equal that tag's firmware
`kProfileReleaseId`; development entries retain the development constant. `values: null` means a full byte. The `page`,
`amount`, `action` and `stateless` fields mirror the firmware definition table.
The page verifies the pinned base app first, patches only bytes 1024–1535, then
encodes and decodes the WAV. The untouched default also checks the release WAV
hash. Custom WAVs and guides carry the first eight hex digits of SHA-256 of the
512-byte profile; share links carry all 512 bytes and the release tag.

CI also runs `test/golden.js` on each manifest app image against its `wav_sha256`. Firmware CI in eurorack separately checks built images against its release hashes.

Publishing: `.github/workflows/pages.yml` runs on pushes to `main`, pull requests
and manual dispatch. It checks out eurorack with full history, tags and submodules,
runs the Node suites and manifest golden checks, builds with the pinned Hugo,
and checks that `public/` equals `static/` byte for byte. Only `main` can deploy
to GitHub Pages at https://insolentconstruct.github.io/hygrostat/.
`hugo.toml` only tells Hugo to copy `static/`; there are no templates yet.

To update the page for a release:

1. Wait for the firmware release tag and its published assets. Copy that tag’s
   `app.bin` into `static/images/<tag>/` and set the manifest entry’s tag, display
   name (for example, “Beta 2 (Fog)”), date and stable download-event slug.
   Replace the development entry, remove its `development` and `source_commit`
   fields, and remove its image and on-page development notice.
2. Take the app size, app/WAV SHA-256 values, profile release ID and catalogue
   from the tagged firmware. The release ID must equal the tag date as
   hexadecimal YYYYMMDD and the firmware constant. Update CPU measurements and
   provenance from the final image; keep estimates labelled. Refresh canonical
   release guides when they change. Feature help resolves `{TAG}` links from
   the selected manifest release, so documentation follows the installed version.
3. Run the Node suites above and the three-browser checks. Verify the untouched
   default WAV against the published release and a custom profile with both
   guides. Run `node tools/version-assets.js` after browser or manifest
   edits, then rerun readiness. The workflow resolves released entries through firmware tags.
4. Merge the page PR into `main` after the tag exists. Check the Pages
   deployment, offered release, default/custom WAVs, guides and deferred counts
   on the live site. GoatCounter public counts must be enabled; new counts can
   take up to four hours to appear. Record the last good deployment and release
   before publishing; follow [ROLLBACK.md](ROLLBACK.md) if a deploy or release
   entry needs withdrawing.

Counting: the first interaction with the page sends one page view (`p=/`, no `e=true`), which is what GoatCounter's site visitor total counts. Successful builds send `/render/<tag>` events; WAV download clicks send one
`download/<release-slug>` event through GoatCounter's scriptless `/count` endpoint (`p` is the event
path and `e=true` marks an event). The event name is
the only application data sent: no profile, fingerprint, custom/default marker,
page URL, referrer or personal data. The request necessarily exposes the browser
and IP address to the service. “Do not track” is respected. Guide downloads are not counted. Both event types use the same tested transport. Custom and default downloads share one event per version because
GoatCounter has no separate event properties that preserve that count page.
See the [GoatCounter endpoint parameters](https://www.goatcounter.com/help/pixel).

The owner must enable **Allow adding visitor counts** in GoatCounter settings.
After the first pointer or keyboard interaction, the page reads `/counter/<encoded-event-name>.json` for each release and adds GitHub release asset
`download_count` values from api.github.com for names ending `-wav.zip`.
Named release download totals appear first, in bold. The secondary site visitor
count uses GoatCounter’s public `/counter/TOTAL.json` endpoint; it is not the
number of successful builds. Both services receive the browser and IP address. Counts may merge repeat
downloads by the same visitor on the same day. Download totals of at least 10 are shown;
otherwise the manifest date is shown, or the line is hidden if no date exists.
Visitor counts are hidden when unavailable. Either download source can fail independently; results (including failures) are cached
in sessionStorage for the browser tab session, with an in-memory fallback.
Requests time out after five seconds and never delay or block building. Tests use only stubbed fetches; the Docker test container runs
without network access. See [public counter setup](https://www.goatcounter.com/help/visitor-counter).

To try the page locally, serve `static/` over HTTP (`python3 -m http.server -d static`); the hash check needs a secure context, which `localhost` is.

Browser modules, worker dependencies and the manifest URL carry `?v=` versions
bound to the manifest and module contents; image URLs carry their SHA-256.
After changing browser code or manifest data, run
`node tools/version-assets.js`. The readiness suite verifies every
referenced browser asset has the matching version or hash.
