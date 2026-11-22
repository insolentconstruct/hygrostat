# Drizzlet Hygrostat

**https://hygrostat.insolentconstruct.net/**

Hygrostat builds a [Drizzlet](https://github.com/insolentconstruct/eurorack/tree/drizzlet) firmware update for Mutable Instruments Beads in your browser. You pick which features your firmware has, where their controls sit and their defaults. You then download the update file (`.wav`) and a printable guide to your layout. Nothing is uploaded. Advanced also offers the matching ST-Link combo files (`.hex` and `.bin`).

It works with Drizzlet Beta 2 and later. Firmware releases are on the [eurorack releases page](https://github.com/insolentconstruct/eurorack/releases).

Beta 2's factory layout is a starting point: change control placement and defaults in Hygrostat to suit your playing. Feedback on Beta 2 may inform a different factory layout in Beta 3; saved custom layouts keep their explicit placements.

For firmware with scale-bank support, the scale editor chooses which scales are available and their order. Replace the default definitions, enter notes in cents or import a Scala file, and choose each scale's LED colour and flash pattern. Off and Chromatic remain separate knob choices. Profiles support up to 14 scales with 24 notes each; shared links and downloaded guides include the bank.

## Privacy

The page counts visits, builds and downloads with [GoatCounter](https://www.goatcounter.com): no cookies, no profile data, and "do not track" is respected. After your first click it also reads public download totals from GoatCounter and GitHub. Like any web request, these reveal your IP address and browser.

Your current setup is kept in this browser (local storage), so a reload reopens it. It is never sent anywhere; **Forget saved setup** at the bottom of the page removes it. It is a convenience, not a backup: a share link keeps a copy.

## Run it locally

```sh
python3 -m http.server -d static
```

Then open http://localhost:8000.

## Development

Read [STYLE.md](docs/STYLE.md) before editing, including agent-assisted work.
See [SECURITY.md](docs/SECURITY.md) for the static build, browser boundaries and deployment checks.
Use Node 22.13+ on the 22 LTS line, or Node 24+, and the pinned lockfile:

```sh
npm ci
npm run lint
npm run lint:controls
```

Lint checks maintained JavaScript, static HTML and inline CSS. It runs as a
required deployment gate. Keep the relevant functional tests below as well;
format and lint checks do not establish firmware or browser correctness.

## Tests

The tests check the page against the firmware it offers. They need a supported Node version, g++, Python 3 and a copy of the firmware repository in `./firmware`:

```sh
git clone --branch drizzlet https://github.com/insolentconstruct/eurorack.git firmware
git -C firmware submodule update --init stmlib
for t in manifest profile draft scales scales_firmware event_costs module_costs downloads combo help layout option_pages readiness costs idle_timeout recent_notes beta3_options hold_rules start_quality options_entry configurable_gestures region catalogue rings; do node test/$t.js; done
```

`test/browser.mjs` and `test/scales_browser.mjs` run the page in Chromium, Firefox and WebKit (CI runs it in the Playwright 1.65.0 image). It needs Playwright with its browsers and the page served locally: `SITE=static BASE=http://localhost:8000/ node test/browser.mjs` (and the same command with `test/scales_browser.mjs`, `test/draft_browser.mjs`, `test/beta3_browser.mjs`, `test/pages_browser.mjs` and `test/gestures_browser.mjs`). The scale, Beta 3 and page browser tests use synthetic release lists and never build or offer a synthetic firmware image. `test/option_pages.js` checks options pages 5–7 with a synthetic seven-page release. `test/idle_timeout.js`, `test/recent_notes.js`, `test/beta3_options.js` and `test/option_pages.js` check against the final Beta 3 firmware commit (override with `BETA3_FIRMWARE_REF`); the firmware clone needs its branches. `test/hold_rules.js` checks the Beta 4 [A] hold rules against the firmware merge commit (override with `HOLD_RULES_FIRMWARE_REF`). `test/start_quality.js` checks the Beta 4 Start in quality against the firmware pull request's commit (override with `START_QUALITY_FIRMWARE_REF`). `test/options_entry.js` checks the Beta 4 options page preview and opening page against the firmware merge commit (override with `OPTIONS_ENTRY_FIRMWARE_REF`). `test/configurable_gestures.js` checks the Beta 4 [A] toggles and [A] + FEEDBACK slot against the firmware pull request and the parser before it (override with `GESTURES_FIRMWARE_REF` and `GESTURES_BASE_FIRMWARE_REF`). `test/scales_firmware.js` checks the V2 codec against the current firmware parser; it needs firmware with scale-bank support. `test/region.js` checks the region writer (`WAVE`, `TERR`, `PLTS`, `RNGS`) and profile version 3 against the blob firmware commit and its `blob_sections.py` (override with `BLOB_FIRMWARE_REF`); the firmware clone needs its branches. `test/catalogue.js` checks catalogue format 2 (manifest digest, record bytes, factory block) and the firmware's shared profile cases in both codecs against the firmware commit that introduced it (override with `CATALOGUE_FIRMWARE_REF`). `test/rings.js` checks the Rings synth (Synth value 2, feature 42, the `RNGS` section and the synth rules) against the firmware pull request's commit (override with `RINGS_FIRMWARE_REF`); with `REGION_BUILD` set to a firmware build's output directory it also checks that the untouched default region written from that build's blobs equals its `region.bin`.

`BASE=http://localhost:8000/ node test/security_browser.mjs` checks actual CSP blocking and referrer behaviour in all three engines without re-encoding a WAV.

After changing anything in `static/js/` or `static/manifest.json`, run `node tools/version-assets.js`.

## Adding a release

1. After the firmware is tagged, copy the tag's `app.bin` to `static/images/<tag>/` and delete the development image.
2. Replace the development entry in `static/manifest.json` with the release: tag, name, date, hashes, profile format and catalogue. Preserve historical measurement data. Set `profile.hold_rules: true` for firmware that refuses other features on the [A] hold (Beta 4 on), and `profile.feedback_slot: true` for firmware with the [A] + FEEDBACK slot and feature 40 (Beta 4 on). Add `combo`: the padded bootloader's and the tag's `combo.bin` hashes from `beads/build/expected-hashes.sha256`, the `-combo.hex` hash from the release's `SHA256SUMS`, and `hex` from `node tools/combo-layout.js <tag>-combo.hex`. Add the tag's `options-guide.svg` and `options-guide-mobile.svg` to `RELEASE_GUIDES` in `static/js/release_guides.js`.
3. Add the release's module-measured costs as `costs/<tag>-module.json` and run `node tools/import-costs.js` (see [module-measured costs](docs/DESIGN.md#module-measured-costs)). Then remove `development` and `source_commit`.
4. Run `node tools/version-assets.js` and the tests.
5. Merge to `main`. CI tests, builds and deploys the page.

If a deploy goes wrong, see [ROLLBACK.md](ROLLBACK.md). Design notes for maintainers are in [docs/DESIGN.md](docs/DESIGN.md).

## Licence

MIT, see [LICENSE](LICENSE). `static/js/glibc_sincos.js` is ported from the GNU C Library (LGPL 2.1 or later, `static/js/COPYING.LIB`). The QPSK encoder follows Mutable Instruments' `stm_audio_bootloader`.
