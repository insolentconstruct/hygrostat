# Hygrostat design notes

For maintainers. Users only need the [README](../README.md).

## How a WAV is made

The page checks the pinned base `app.bin` against its SHA-256 and patches only the profile, bytes 1024–1535. It then encodes the WAV and decodes it back to check it. The untouched default must match the release WAV's hash too. Custom WAVs and guides carry the first eight hex digits of the profile's SHA-256; share links carry all 512 bytes and the release tag.

- `static/js/encoder.js`: Mutable Instruments' QPSK encoder (`stm_audio_bootloader/qpsk/encoder.py`), as Beads' release build runs it. One unminified module, used by the page and the tests.
- `static/js/glibc_sincos.js`: sine and cosine ported from glibc 2.36. The release WAV is encoded by numpy on glibc, and one last bit of a sine decides between samples 32766 and 32767; the browser's `Math.sin` differs in about 636,000 samples of the Beta 2 file.
- `static/js/decoder.js`: QPSK demodulator for generated WAVs (packet headers, CRCs, descrambling, padding). It checks generated files, not recorded audio.
- `static/js/worker.js`: encoding and the decode-back check run in a worker.
- Images are served with the page because GitHub release downloads can't be fetched from another site.

## Profiles

- `static/js/profile.js`: profile parser and encoder, validation, templates, share links, fingerprints, names and CPU rules. Its metadata mirrors the firmware's `beads/profile.cc`.
- `test/profile.js` compiles the firmware's own parser from the release and compares it with the page's on more than 26,000 candidate profiles.
- The page refuses conflicts and anything the firmware would refuse. Only profile-capable releases (Beta 2 and later) are offered.

## Editor

- The page shows the module's destinations: options pages 1–4 (rows) by FEEDBACK, DRY/WET and REVERB (columns), two [A] amounts and three [A] gestures. Off, Fixed and Adjustable are shown as "Use stock behaviour", "Always use this value" and "Change on the module".
- `static/js/layout.js` holds the editor rules. State, value and slot edits use the previous editor's rule unchanged; `test/layout.js` checks it against a verbatim copy and checks every placement, swap and removal.
- Placing a feature on a taken destination offers Swap (the occupant takes the feature's old place) or Replace (the occupant leaves). A feature taken off its last control keeps its value as Fixed, or goes Off at value 0; a Fixed gesture-only setting goes Off without its gesture.
- `static/js/panel.js` draws the whole front panel to scale from the guide's geometry (`panel_geometry.tsv` in the firmware) and highlights the selected destination's controls.

## Manifest (`static/manifest.json`, format 2)

- Each release pins its app image and WAV by SHA-256 and carries its profile offset, size, version, release ID and feature table.
- `release_id` is the tag date as hex YYYYMMDD (2026-11-05 is `0x20261105`) and must equal the tag's `kProfileReleaseId`. Development entries keep the development constant.
- The feature catalogue (23 features) must match the firmware's `beads/build/profile-features.json` at the release, byte for byte. `FIRMWARE_CATALOGUE_REF` adds a check against a second firmware revision.
- `default_in_block: false` leaves a feature out of the default profile while its default stays available in the editor. `values: null` means a full byte. `page`, `amount`, `action` and `stateless` mirror the firmware table.

## Firmware checks

Tests read firmware files with `git -C $FIRMWARE_REPO show <ref>:<file>`, where `<ref>` is the manifest's `source_commit` (development) or `refs/tags/<tag>`. So the page is always checked against the release it offers, not the firmware branch's current state. CI also runs `test/golden.js` on each manifest image against its WAV hash.

## CPU estimates

- Per-feature costs were measured on a development board calibrated to the module. Four event-only features have no per-block cost.
- Baselines are module measurements of the default profile: synth 87.2% (with Clouds-style reverb), granular 83.0%. Each feature adds its cost minus its default's cost, so moving a control between slots doesn't change the estimate.
- Exact module measurements of a complete profile (`cpu.combinations[].profile`, hex) take precedence over estimates.
- Each engine rounds to 0.1%. The page warns from 91% and blocks above the provisional 92% ceiling (vanilla granular measured 92.1%). If an enabled setting has no measured cost and isn't covered by the default, the page lists it and does not warn or block. Exact module measurements still warn or block, and the release default is always allowed.
- Remeasure the default and heaviest combinations on the final image before each release.

## Guides

`static/js/guide.js` draws custom layouts with knob geometry ported from the firmware's `options_guide.py`. `release_guides.js` holds the release's own SVGs for the untouched default; apart from the added fingerprint element, the default guide must equal the release SVG byte for byte.

## Counting

- The first click or keypress sends one GoatCounter page view (`p=/`), which is what the site visitor total counts.
- Builds send `/render/<tag>` events and WAV download clicks send `download/<release-slug>` events, through the scriptless `/count` endpoint (`e=true` marks an event). The event name is the only data sent. Do Not Track is respected. Guide downloads are not counted.
- After the first interaction the page reads per-release totals from `/counter/<event>.json` plus GitHub `download_count` for `-wav.zip` assets, and the site total from `/counter/TOTAL.json`. This needs **Allow adding visitor counts** in GoatCounter settings.
- Totals of 10 or more are shown, otherwise the release date. Results are cached for the tab session; requests time out after five seconds and never block building. Tests use stubbed fetches only.

## Asset versions

Browser modules, the worker and the manifest URL carry `?v=` tokens bound to their contents; image URLs carry their SHA-256. `node tools/version-assets.js` regenerates them and the readiness test checks them.

## Hosting

Hugo copies `static/` unchanged (no templates yet); CI checks `public/` equals `static/` byte for byte. Only `main` deploys, to GitHub Pages at https://hygrostat.insolentconstruct.net/.
