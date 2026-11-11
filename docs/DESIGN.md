# Hygrostat design notes

For maintainers. Users only need the [README](../README.md).

## How a WAV is made

The page checks the pinned base `app.bin` against its SHA-256 and patches only the release-declared profile region: the current V2 block occupies bytes 1024–5119 (4096 bytes); legacy V1 blocks occupy 512 bytes. It then encodes the WAV and decodes it back to check it. The untouched default must match the release WAV's hash too. Custom WAVs and guides carry the first eight hex digits of the profile's SHA-256; share links carry the complete release-sized profile block and the release tag.

- `static/js/encoder.js`: Mutable Instruments' QPSK encoder (`stm_audio_bootloader/qpsk/encoder.py`), as Beads' release build runs it. One unminified module, used by the page and the tests.
- `static/js/glibc_sincos.js`: sine and cosine ported from glibc 2.36. The release WAV is encoded by numpy on glibc, and one last bit of a sine decides between samples 32766 and 32767; the browser's `Math.sin` differs in about 636,000 samples of the Beta 2 file.
- `static/js/decoder.js`: QPSK demodulator for generated WAVs (packet headers, CRCs, descrambling, padding). It checks generated files, not recorded audio.
- `static/js/worker.js`: encoding and the decode-back check run in a worker.
- Images are served with the page because GitHub release downloads can't be fetched from another site.

## Profiles

- `static/js/profile.js`: profile parser and encoder, validation, templates, share links, fingerprints and names. Its metadata mirrors the firmware's `beads/profile.cc`. Historical CPU helpers remain for reference tests; the editor does not use them.
- `test/profile.js` compiles the firmware's own parser from the release and compares it with the page's on more than 26,000 candidate profiles.
- The page refuses conflicts and anything the firmware would refuse. Only profile-capable releases (Beta 2 and later) are offered.

## Editor

- The page shows the module's destinations: options pages (rows) by FEEDBACK, DRY/WET and REVERB (columns), two [A] amounts and three [A] gestures. Off, Fixed and Adjustable are shown as "Use stock behaviour", "Always use this value" and "Change on the module".
- `static/js/layout.js` holds the editor rules. State, value and slot edits use the previous editor's rule unchanged; `test/layout.js` checks it against a verbatim copy and checks every placement, swap and removal.
- Placing a feature on a taken destination offers Swap (the occupant takes the feature's old place) or Replace (the occupant leaves). A feature taken off its last control keeps its value as Fixed, or goes Off at value 0; a Fixed gesture-only setting goes Off without its gesture.
- `static/js/panel.js` draws the whole front panel to scale from the guide's geometry (`panel_geometry.tsv` in the firmware) and highlights the selected destination's controls.

## Manifest (`static/manifest.json`, format 3)

- Each release pins its app image and WAV by SHA-256 and carries its profile offset, size, version, format and feature table.
- `profile.format` is the firmware's assigned `kProfileFormat`, written little endian to profile bytes 8–11 (Beta 2: 1). It changes only when existing profile bytes change meaning, so it may stay the same across releases; nothing is derived from the tag or its date. A block with another number, including the former date ID `0x20261101`, is refused even with a valid checksum, as the firmware refuses it. Development entries pin `source_commit` instead of a tag; they establish no release tag or module qualification. Format 3 replaced format 2's dated `release_id`.
- The current feature catalogue (24 features) must match the firmware's `beads/build/profile-features.json` at the release, byte for byte. `FIRMWARE_CATALOGUE_REF` adds a check against a second firmware revision.
- A release's optional `profile.page_leds` lists each options page's mix LEDs (FEEDBACK 1, DRY/WET 2, REVERB 4). Absent means Beta 2's four pages, `[1, 2, 4, 7]`; the only other accepted value is the proposed seven-page `[1, 2, 4, 3, 5, 6, 7]`. It sets the page positions the editor offers and validates, the grid, the panel LEDs and guide wording, and must match the firmware's `kNumPageSlots`. The editor shows the pages [M] cycles through and offers compaction only as a previewed action.
- `default_in_block: false` leaves a feature out of the default profile while its default stays available in the editor. `values: null` means a full byte. `page`, `amount`, `action` and `stateless` mirror the firmware table.

## Firmware checks

Tests read firmware files with `git -C $FIRMWARE_REPO show <ref>:<file>`, where `<ref>` is the manifest's `source_commit` (development) or `refs/tags/<tag>`. So the page is always checked against the release it offers, not the firmware branch's current state. CI also runs `test/golden.js` on each manifest image against its WAV hash.

Templates keep Drizzlet and Stock plus fixes as direct choices. Seven focused starting points start from all features Off. The grouped gallery previews changed controls and values; only Use applies a template. Previewing leaves the profile, share link, guides and firmware build unchanged.

The Drizzlet template copies the selected firmware's embedded defaults. Beta 2
places page 2 Frozen feedback on FEEDBACK, Delay mode on DRY/WET and
Reverb character on REVERB. Publish that layout only with its matching app,
catalogue and guides: changing default slots changes the profile block and CRC.
Do not rewrite an existing custom profile's explicit slots when defaults change.

## Kept setup

`static/js/draft.js` keeps the setup in `localStorage` so a reload reopens it. A draft is JSON with a schema `v` (1), the save time, the exact share fragment, and the release name, profile version and format; a starting-point name is kept only if it is a template. Nothing is sent anywhere.

- Only edits save: `commit()` and a release change mark the draft, and `refresh()` writes it from the block it already encodes. Selection, dialogs and opening a link never save. The page's fresh state (Drizzlet defaults, factory scales, newest release) removes the draft.
- On load a share link wins and leaves the draft alone. The first edit to a shared setup first copies the person’s own draft to `hygrostat-draft-before-link`; a draft that started from a link is marked and copied there only when the slot is empty, so later links never replace the own setup. **Open it** swaps the two slots. The first edit after a link or **Share** also removes the fragment from the address.
- Restore uses `unshare()` and must re-encode to the stored bytes. A draft whose tag is gone moves to the newest release with the same profile version and format. Anything else, in either slot, is refused on load: the text goes to `hygrostat-draft-refused` (one slot, never overwritten) or, if that is taken, stays in place and saving pauses. Only the person discards it.
- **Start fresh** (with Undo) and **Forget saved setup** are the only other ways a draft goes, apart from clearing site data.

## Historical CPU estimates

The launch editor does not display CPU estimates or use them to block builds.
The following data and helper tests are retained as historical evidence, not an
assurance that every configuration is safe or a measured physical CPU limit.
Any future estimator needs separately qualified workloads and policy.

- Per-feature costs were measured on a development board calibrated to the module. Four event-only features have no per-block cost.
- Baselines are worst-case module measurements: synth 83.4% (with Clouds-style reverb, measured on the codec-fix Beta 2 timing build), granular 83.0% (an October build, before profiles). Each feature adds its cost minus its default's cost, so moving a control between slots doesn't change the estimate.
- Per-feature costs on the development board predict module changes within about half a point on the granular engine; setting combinations still need module measurement.
- Exact module measurements of a complete profile (`cpu.combinations[].profile`, hex) take precedence over estimates.
- The historical helper rounds each engine to 0.1%, warns from 91% and marks values above the provisional 92% policy as blocked. This policy was not a measured failure threshold. These results no longer control the page or its downloads.

## Guides

`static/js/guide.js` draws custom layouts with knob geometry ported from the firmware's `options_guide.py`. `release_guides.js` holds the release's own SVGs for the untouched default, selected by `RELEASE_GUIDE_TAG` because the profile format can stay the same across releases; apart from the added fingerprint element, the default guide must equal the release SVG byte for byte.

## Counting

- The first click or keypress sends one GoatCounter page view (`p=/`), which is what the site visitor total counts.
- Builds send `/render/<tag>` events and WAV download clicks send `download/<release-slug>` events, through the scriptless `/count` endpoint (`e=true` marks an event). The event name is the only data sent. Do Not Track is respected. Guide downloads are not counted.
- After the first interaction the page reads per-release totals from `/counter/<event>.json` plus GitHub `download_count` for `-wav.zip` assets, and the site total from `/counter/TOTAL.json`. This needs **Allow adding visitor counts** in GoatCounter settings.
- Totals of 10 or more are shown, otherwise the release date. Results are cached for the tab session; requests time out after five seconds and never block building. Tests use stubbed fetches only.

## Asset versions

Browser modules, the worker and the manifest URL carry `?v=` tokens bound to their contents; image URLs carry their SHA-256. `node tools/version-assets.js` regenerates them and the readiness test checks them.

## Hosting

Hugo copies `static/` unchanged (no templates yet); CI checks `public/` equals `static/` byte for byte. Only `main` deploys, to GitHub Pages at https://hygrostat.insolentconstruct.net/.

## Beta 2 factory layout

The accepted Beta 2 factory layout keeps Pitch scale, Random pitch steps and Attacks on page 1; page 2 is Frozen feedback, Delay mode and Reverb character; page 3 remains Processor, Synth and Synth start. Page 4 adds LED brightness and SEED latch beside Limiter, initially 100%, Off (Stock) and Stock. Users can change placements and defaults in Hygrostat. Beta 2 feedback may inform Beta 3's factory layout; existing custom profiles retain their explicit placements.

The Beta 2 release entry is `drizzlet-2026.11.09`, source `578521f`. Its `date` is the UTC publication date, `2026-11-10`; the tag uses the maintainer's local release date. Tests read the tag's own app/WAV pins, guides and catalogue. The synth baseline was measured on this release's timing build; the granular baseline and cost table are historical. Setting combinations remain unmeasured.

The release keeps the historical granular baseline and cost table unchanged. `cpu.estimate_reference` pins the former estimator defaults and their firmware source/profile hash; `default_measured: false` prevents new-default measurement claims. The table-derived Off-to-Adjustable allowances are 0.492 synth and 0.737 granular points, yielding provisional default estimates of 83.9% and 83.7%. These are estimates, not module measurements of the new default; legacy explicit profiles cancel those allowances. Runtime estimation checks the declared allowances against the same reference costs, and incomplete or contradictory reference flags refuse.
