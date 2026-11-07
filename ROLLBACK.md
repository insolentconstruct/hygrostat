# Rolling back

**Bad page deploy:** revert it on `main` (`git revert -m 1 <merge-commit>`, or `git revert <commit>` for a squash merge). CI redeploys the previous page.

**Bad release entry:** restore `static/manifest.json` and the previous `static/images/<tag>/app.bin` from the last good commit, run `node tools/version-assets.js`, and merge.

**Bad firmware release:** on the eurorack releases page, mark it as a pre-release and make the previous release Latest. Keep its files for people who already downloaded them.

Then reload the live page (allow ten minutes for caching), build the default WAV and check its SHA-256 against the manifest. Rolling back the page does not downgrade anyone's module; they reinstall the previous release's WAV.
