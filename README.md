# Drizzlet Hygrostat

**https://hygrostat.insolentconstruct.net/**

Hygrostat builds a [Drizzlet](https://github.com/insolentconstruct/eurorack/tree/drizzlet) firmware update for Mutable Instruments Beads in your browser. You pick which features your firmware has, where their controls sit and their defaults. You then download the update file (`.wav`) and a printable guide to your layout. Nothing is uploaded.

It works with Drizzlet Beta 2 and later. Firmware releases are on the [eurorack releases page](https://github.com/insolentconstruct/eurorack/releases).

## Privacy

The page counts visits, builds and downloads with [GoatCounter](https://www.goatcounter.com): no cookies, no profile data, and "do not track" is respected. After your first click it also reads public download totals from GoatCounter and GitHub. Like any web request, these reveal your IP address and browser.

## Run it locally

```sh
python3 -m http.server -d static
```

Then open http://localhost:8000.

## Tests

The tests check the page against the firmware it offers. They need Node 18+, g++, and a copy of the firmware repository in `./firmware`:

```sh
git clone --branch drizzlet https://github.com/insolentconstruct/eurorack.git firmware
git -C firmware submodule update --init stmlib
for t in manifest profile downloads help layout readiness costs; do node test/$t.js; done
```

`test/browser.mjs` runs the page in Chromium, Firefox and WebKit (CI runs it in the Playwright 1.48.2 image). It needs Playwright with its browsers and the page served locally: `SITE=static BASE=http://localhost:8000/ node test/browser.mjs`.

After changing anything in `static/js/` or `static/manifest.json`, run `node tools/version-assets.js`.

## Adding a release

1. After the firmware is tagged, copy the tag's `app.bin` to `static/images/<tag>/` and delete the development image.
2. Replace the development entry in `static/manifest.json` with the release: tag, name, date, hashes, profile release ID, catalogue and CPU measurements from the tagged firmware. Remove `development` and `source_commit`. Update `static/js/release_guides.js` if the release guides changed.
3. Run `node tools/version-assets.js` and the tests.
4. Merge to `main`. CI tests, builds and deploys the page.

If a deploy goes wrong, see [ROLLBACK.md](ROLLBACK.md). Design notes for maintainers are in [docs/DESIGN.md](docs/DESIGN.md).

## Licence

MIT, see [LICENSE](LICENSE). `static/js/glibc_sincos.js` is ported from the GNU C Library (LGPL 2.1 or later, `static/js/COPYING.LIB`). The QPSK encoder follows Mutable Instruments' `stm_audio_bootloader`.
