# Hygrostat style and development

Read this before editing. Keep the site as plain HTML, CSS and JavaScript
modules; it does not need a framework, bundler or a formatting rewrite.

## Code

Use two spaces, LF line endings, semicolons and single-quoted JavaScript
strings; double quotes are fine when they avoid escaping an apostrophe.
EditorConfig supplies indentation. Lint enforces the small shared conventions
and recommended correctness rules. Keep existing compact CSS and continuation
layouts. Limit reflow to edited code.

Keep responsibilities clear: profile/scales validate and encode data without
the DOM; encoder/decoder handle the update format; guide/layout/panel handle
presentation; app coordinates UI state; the worker has no DOM access. Pass
state explicitly, use descriptive names and extract repeated logic into small
helpers instead of adding hidden globals or parallel copies of a format.

Use const unless the binding changes. Validate before producing a download;
reject unsupported or malformed input with a useful message. Preserve error
causes when translating failures. Catch optional counter/cache failures only
with an explanation; unexpected codec or validation failures must remain
visible. Prefer textContent and DOM construction over interpolating user text
into markup. Keep untrusted scale names escaped in generated guides.

HTML attributes use double quotes. Retain semantic elements, labels, keyboard
access and existing focus behaviour. CSS stays in index.html unless a change
has a clear reason to move it; Stylelint parses its style blocks and attributes
with postcss-html. Reuse existing variables and responsive breakpoints.
The descending-specificity rule is disabled because it compares selectors in
independent components without knowing their DOM; preserve each component
cascade instead of globally sorting unrelated selectors.

## Checks and review

Development tooling needs Node 22.13+ on the 22 LTS line, or Node 24+. CI uses
Node 22. Dependencies have exact direct versions and a committed npm lockfile.

```sh
npm ci
npm run lint
npm run lint:controls
```

The lint command runs ESLint recommended checks on maintained JavaScript,
including tests and tools, HTMLHint on static HTML and Stylelint recommended
checks on CSS and HTML-embedded CSS. Browser, worker and Node globals are
separate; Playwright test files also contain page callbacks. Negative controls
check that representative bad JavaScript, markup and CSS are actually refused.
The lint job is required before deployment, alongside build and browser tests.

Generic JavaScript style rules skip only static/js/glibc_sincos.js (vendored
arithmetic) and static/js/release_guides.js (generated drawings). Recommended
bug checks still cover both, except the intentional rounded decimal constants
in glibc. Keep their licence/provenance and dedicated golden/guide parity checks; do not hand-format them. The intentional control-character
regexp in scale validation has one explained rule exception and functional
coverage. Do not add blanket disables or turn errors into a passing baseline.

Lint is the first check, not a replacement for tests. Run the affected Node
suites listed in README.md. Codec, catalogue, manifest, cost or guide changes
need the complete Node set and pinned firmware agreement. DOM, CSS, worker or
download-flow changes need both browser suites in Chromium, Firefox and WebKit.
Keep meaningful negative cases; fix failures without weakening expectations.

After browser JavaScript or manifest edits run node tools/version-assets.js.
Review the diff, run the relevant checks, obtain an independent review, verify
findings and re-review fixes before committing. Agent work follows the same
sequence; read this file first and report checks and remaining limits clearly.
Keep private machine/user details out of public changes. Never publish or
deploy without owner approval; the Beta 2 editor follows the firmware tag.

## Firmware and generated data

Feature IDs, packed settings meanings, release identity, checksums and app/WAV
pins are contracts. Do not silently reinterpret them or truncate imported
scales. Keep historical measured CPU data immutable and distinguish measured,
inspected zero and unmeasured costs. Test fixtures are not performance evidence.
Generate canonical release drawings from the firmware tools, then verify their
bytes and customized guides. Keep changes focused and preserve attribution.

Tool references: [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files),
[HTMLHint configuration](https://htmlhint.com/configuration/) and
[Stylelint configuration](https://stylelint.io/user-guide/configure/).
