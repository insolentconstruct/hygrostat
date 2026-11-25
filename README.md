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
for t in manifest profile draft scales scales_firmware event_costs module_costs downloads combo help layout option_pages readiness costs idle_timeout recent_notes beta3_options hold_rules start_quality options_entry configurable_gestures region catalogue resonator rings wavetables terrain palette starter_banks beta4_output; do node test/$t.js; done
```

`test/browser.mjs` and `test/scales_browser.mjs` run the page in Chromium, Firefox and WebKit (CI runs it in the Playwright 1.65.0 image). It needs Playwright with its browsers and the page served locally: `SITE=static BASE=http://localhost:8000/ node test/browser.mjs` (and the same command with `test/scales_browser.mjs`, `test/draft_browser.mjs`, `test/beta3_browser.mjs`, `test/pages_browser.mjs` and `test/gestures_browser.mjs`). The scale, Beta 3 and page browser tests use synthetic release lists and never build or offer a synthetic firmware image. `test/option_pages.js` checks options pages 5–7 with a synthetic seven-page release. `test/idle_timeout.js`, `test/recent_notes.js`, `test/beta3_options.js` and `test/option_pages.js` check against the final Beta 3 firmware commit (override with `BETA3_FIRMWARE_REF`); the firmware clone needs its branches. `test/hold_rules.js` checks the Beta 4 [A] hold rules against the firmware merge commit (override with `HOLD_RULES_FIRMWARE_REF`). `test/start_quality.js` checks the Beta 4 Start in quality against the firmware pull request's commit (override with `START_QUALITY_FIRMWARE_REF`). `test/options_entry.js` checks the Beta 4 options page preview and opening page against the firmware merge commit (override with `OPTIONS_ENTRY_FIRMWARE_REF`). `test/configurable_gestures.js` checks the Beta 4 [A] toggles and [A] + FEEDBACK slot against the firmware pull request and the parser before it (override with `GESTURES_FIRMWARE_REF` and `GESTURES_BASE_FIRMWARE_REF`). `test/resonator.js` checks the Beta 4 resonator features, their exact values, the eight Materials and the exact-value page rule against the firmware's catalogue, definitions and parser (override with `RESONATOR_FIRMWARE_REF`). `test/scales_firmware.js` checks the V2 codec against the current firmware parser; it needs firmware with scale-bank support. `test/region.js` checks the region writer (`WAVE`, `TERR`, `PLTS`, `RNGS`) and profile version 3 against the blob firmware commit and its `blob_sections.py` (override with `BLOB_FIRMWARE_REF`); the firmware clone needs its branches. `test/catalogue.js` checks catalogue format 2 (manifest digest, record bytes, factory block) and the firmware's shared profile cases in both codecs against the Beta 4 firmware commit (override with `CATALOGUE_FIRMWARE_REF`). `test/rings.js` checks the Rings synth (Synth value 2, feature 42, the `RNGS` section and the synth rules) against the Beta 4 firmware commit (override with `RINGS_FIRMWARE_REF`); with `REGION_BUILD` set to a firmware build's output directory it also checks that the untouched default region written from that build's blobs equals its `region.bin`.

`test/wavetables.js` checks that the wavetable editor's untouched table equals the firmware's factory bytes, both its committed `beads/resources.cc` and `beads/resources/wavetables.py` run through `test/wavetables_py.py` (needs Python 3 with numpy; set `PYTHON` to choose the interpreter; override the firmware commit with `WAVETABLES_FIRMWARE_REF`). `test/terrain.js` checks the terrain equation parser, including refused and random input. `test/editor_browser.mjs` runs the editor page (`editor.html`) in the three browsers. `test/palette.js`, `test/palette_browser.mjs` and `test/palette_regressions_browser.mjs` check synth locks, bank selection, flash accounting and portable profiles; the browser fixture uses synthetic assets and never offers a firmware image.

`BASE=http://localhost:8000/ node test/security_browser.mjs` checks actual CSP blocking and referrer behaviour in all three engines without re-encoding a WAV.

After changing anything in `static/js/` or `static/manifest.json`, run `node tools/version-assets.js`.

`REACHABILITY_FIRMWARE_REF=<candidate> node test/reachability.js` checks every
Synth/Synth start state, value, page and gesture combination against that
firmware's parser, including accepted bytes. Set
`profile.reachability_rules: true` only for firmware that refuses Synth start
on [A] + FREEZE when Plaits or Rings can be selected; older releases keep
their own rules. Matching firmware also keeps the Plaits bank and manual Synth start
reachable when missing or damaged Beads waves force the Plaits fallback.
`node test/fallback_guide.js` checks the desktop and mobile fallback notes;
historical releases keep their original guides.

To check the staged Beta 4 entry against an integration build, pass the
firmware ref, the build output containing `app.bin` and the entry JSON
(`releases/beta4-development.json` on the staged entry branch):

```sh
node tools/check-beta4-wav.js firmware origin/beta4/integration BUILD_DIR ENTRY_JSON
```

The check reads the pins from the supplied ref. It rebuilds the stock region
from the entry's blobs and checks the full install image and WAV. For a new
freeze, re-import the catalogue from the matching build and use its index as
`ENTRY_JSON`; pass the asset root as the last argument if it differs from
`static`. The Pages manifest test performs the full-image pin check for
region-enabled releases in the live manifest.

## Adding a release

1. After the firmware is tagged, copy the tag's `app.bin` to `static/images/<tag>/` and delete the development image.
2. Replace the development entry in `static/manifest.json` with the release: tag, name, date, hashes, profile format and catalogue. Preserve historical measurement data. Set `profile.hold_rules: true` for firmware that refuses other features on the [A] hold (Beta 4 on), and `profile.feedback_slot: true` for firmware with the [A] + FEEDBACK slot and feature 40 (Beta 4 on). Add `combo`: the padded bootloader's and the tag's `combo.bin` hashes from `beads/build/expected-hashes.sha256`, the `-combo.hex` hash from the release's `SHA256SUMS`, and `hex` from `node tools/combo-layout.js <tag>-combo.hex`. Add the tag's `options-guide.svg` and `options-guide-mobile.svg` to `RELEASE_GUIDES` in `static/js/release_guides.js`.
3. Add the release's module-measured costs as `costs/<tag>-module.json` and run `node tools/import-costs.js` (see [module-measured costs](docs/DESIGN.md#module-measured-costs)). Then remove `development` and `source_commit`.
4. Run `node tools/version-assets.js` and the tests.
5. Merge to `main`. CI tests, builds and deploys the page.

If a deploy goes wrong, see [ROLLBACK.md](ROLLBACK.md). Design notes for maintainers are in [docs/DESIGN.md](docs/DESIGN.md).

## Licence

MIT, see [LICENSE](LICENSE). `static/js/glibc_sincos.js` is ported from the GNU C Library (LGPL 2.1 or later, `static/js/COPYING.LIB`). The QPSK encoder follows Mutable Instruments' `stm_audio_bootloader`.

Palette starter banks live in `static/starter-banks.json`. Each button adds one
bank of eight models, preserving existing models, banks and editor content.
The editor checks the selected release's pinned assets and available flash
before applying it. Unavailable banks are disabled; oversized additions leave
the setup unchanged. `test/starter_banks_browser.mjs` checks this in all three
browsers.

Beta 4 output options are prepared without changing released manifests.
`test/beta4_output.js` checks the development firmware catalogues for Mix law's
Send value (32), Synth output level (50), Grain output division (51) and the
page-assignable Gain ceiling (52). It verifies manifest digests, definitions,
record offsets and profile round trips. When firmware lands, generate its
catalogue from `beads/resources/features.json`, read it with
`tools/catalogue.js` (`catalogueAtRef` and `catalogueFeatures`), and include
those features in that release's profile metadata. Never copy feature rows by
hand. The selected release supplies the available values and controls; help
and customized guides follow it. Keep release image and WAV pins tied to the
actual build and run the complete agreement suites before offering it.
