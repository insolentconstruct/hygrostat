# Static site and browser boundaries

Hygrostat uses Hugo to copy `static/` to the published site byte for byte.
There is no application server, login, upload endpoint or runtime package
installation. Firmware generation happens in a same-origin module worker.
Keeping that design small makes its boundaries easier to review.

## Build and deployment

CI verifies the pinned Hugo download checksum, builds with warnings treated as
errors and compares the output with `static/`. Hugo cannot run subprocesses,
fetch remote resources or read environment variables through templates: this
copy-only build needs none of those capabilities. Do not enable a capability
without a concrete feature and review. Generated output stays out of Git.

Actions use pinned revisions and minimal job permissions. Only the deployment
job receives Pages/OIDC write permissions; it needs successful lint, build and
browser jobs and runs only on main. Repository changes do not authorize an
early editor deployment: rollout follows the firmware tag and owner approval.
After deployment, verify the custom domain, HTTPS response and actual assets;
green local tests alone do not establish that the public site is serving them.

## JavaScript and data

Use DOM construction and textContent for user-visible values. Do not evaluate
user strings or insert them as HTML. SVG text is escaped; scale names keep
their original profile bytes, while the two Unicode noncharacters XML cannot
display appear as a replacement character in SVG guides.

Local firmware must match the selected release size before it is read, then
match its SHA-256 and default profile. Scala imports are limited to 64 KiB
before reading. Shared profiles have exact size, version, release, field and
checksum checks; malformed or unsupported data is rejected. These checks do
not establish that an unrelated firmware image is safe to install.

Encoding runs off the UI thread. Workers terminate on completion or error;
download object URLs are revoked when replaced. Keep the real firmware
parser differential tests, decoded-WAV checks and three-browser tests when
changing these paths. Lint is not a substitute for them.

## Browser policy and privacy

The CSP appears before page resources. Scripts and workers are same-origin;
inline scripts and eval are not enabled. Objects, base URLs and form submission
are disabled. The inline-style allowance is confined to CSS for the existing
page and dynamic presentation; it does not allow inline JavaScript. If styles
move to separate files, revisit that allowance rather than broadening policy.
The page and counter requests use no-referrer policies.

Counter requests use only release/event paths, omit credentials and respect
Do Not Track. Files, profile contents and scale definitions are not uploaded.
Share data stays in the URL fragment, which is not part of an HTTP request.

Some controls, including CSP frame-ancestors, require HTTP headers and cannot
be enforced through a CSP meta element. Verify available hosting controls;
do not add an ineffective meta directive and describe it as protection.

## Dependencies and checks

Tooling dependencies are development-only, locked and installed with npm ci;
they are not copied into the site. The explicit glob/minimatch overrides
select patched versions and are checked with actual lint discovery and
positive/negative controls. Review upstream compatibility before changing them.
Run npm audit when changing the lockfile; do not apply a forced downgrade or
hide findings to obtain a clean result. A clean audit is a dated dependency
check, not a claim that the whole application is vulnerability-free.

See [STYLE.md](STYLE.md) for the required agent/edit/review workflow.

References: [Hugo security model](https://gohugo.io/about/security/),
[Hugo security allowlists](https://gohugo.io/configuration/security/),
[Hugo on GitHub Pages](https://gohugo.io/host-and-deploy/deploy-to-github-pages/),
[MDN CSP guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP)
and [frame-ancestors limitations](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
