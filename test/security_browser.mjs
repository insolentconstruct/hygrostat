// Copyright 2026 Insolent Construct. MIT licence: see ../LICENSE.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8080/';
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/security-script-probe.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.hygrostatExternalProbe = true;
        try { new Function('return true')(); }
        catch (error) { window.hygrostatEvalBlocked = error.name === 'EvalError'; }`
    }));
    let referred;
    await page.route('https://api.github.com/hygrostat-referrer-probe', (route) => {
      referred = route.request().headers().referer;
      return route.fulfill({ contentType: 'text/plain', body: 'ok',
        headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(base);
    await page.waitForSelector('#build:not([disabled])');
    await page.evaluate(() => {
      window.hygrostatInlineProbe = false;
      window.hygrostatInlineBlocked = false;
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.blockedURI === 'inline' && event.effectiveDirective.startsWith('script-src')) {
          window.hygrostatInlineBlocked = true;
        }
      });
      const script = document.createElement('script');
      script.textContent = 'window.hygrostatInlineProbe = true;';
      document.head.append(script);
    });
    await page.waitForFunction(() => window.hygrostatInlineBlocked === true);
    assert.equal(await page.evaluate(() => window.hygrostatInlineProbe), false,
      `${name}: inline script must not execute`);
    await page.addScriptTag({ url: new URL('security-script-probe.js', base).href });
    assert.equal(await page.evaluate(() => window.hygrostatExternalProbe), true,
      `${name}: permitted same-origin script actually ran`);
    assert.equal(await page.evaluate(() => window.hygrostatEvalBlocked), true,
      `${name}: dynamic code compilation is refused by CSP`);
    assert.equal(await page.evaluate(async () =>
      (await fetch('https://api.github.com/hygrostat-referrer-probe')).text()), 'ok');
    assert.equal(referred, undefined, `${name}: page-wide policy omits the referrer`);
    // Inline CSS is refused in both forms; styles set through the CSSOM, as the page does, still apply.
    const styles = await page.evaluate(() => {
      const probe = document.createElement('p');
      probe.className = 'hygrostat-style-probe';
      document.body.append(probe);
      const sheet = document.createElement('style');
      sheet.textContent = '.hygrostat-style-probe { margin-right: 9px; }';
      document.head.append(sheet);
      probe.setAttribute('style', 'margin-top: 11px');
      probe.style.marginLeft = '7px';
      const { marginRight, marginTop, marginLeft } = getComputedStyle(probe);
      return { marginRight, marginTop, marginLeft,
        tabs: document.querySelector('.page-tabs').style.gridTemplateColumns,
        swatch: getComputedStyle(document.querySelector('.scale-swatch')).backgroundColor };
    });
    assert.equal(styles.marginRight, '0px', `${name}: an inline style element is refused`);
    assert.notEqual(styles.marginTop, '11px', `${name}: a style attribute is refused`);
    assert.equal(styles.marginLeft, '7px', `${name}: a style property set from script applies`);
    assert.match(styles.tabs, /^repeat\(\d+, 1fr\)$/, `${name}: the page tabs keep their script-set columns`);
    assert.match(styles.swatch, /^rgb\(/, `${name}: scale swatches keep their script-set colour`);
    assert.notEqual(styles.swatch, 'rgb(0, 0, 0)');
    await page.goto(base + 'editor.html');
    await page.waitForSelector('main canvas');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).marginTop), '0px', `${name}: the editor stylesheet loaded`);
    // A framed copy hides itself, and leaves a frame that lets it.
    for (const file of ['', 'editor.html']) {
      const framer = await browser.newPage();
      await framer.route('**/framed-probe*', (route) => route.fulfill({ contentType: 'text/html',
        body: `<!doctype html><title>Frame</title><iframe ${route.request().url().includes('sandbox') ? 'sandbox="allow-scripts allow-same-origin" ' : ''}src="${base}${file}"></iframe>` }));
      await framer.goto(new URL('framed-probe-sandbox', base).href);
      const frame = framer.frames()[1];
      await frame.waitForFunction(() => getComputedStyle(document.documentElement).display === 'none');
      assert.equal(framer.url(), new URL('framed-probe-sandbox', base).href, `${name}: a sandboxed frame cannot leave`);
      // The frame may leave before the probe finishes loading, so only its commit is awaited.
      await framer.goto(new URL('framed-probe', base).href, { waitUntil: 'commit' });
      await framer.waitForURL(base + file);
      await framer.waitForFunction(() => getComputedStyle(document.documentElement).display !== 'none');
      await framer.close();
    }
    console.log(`PASS ${name}: real CSP blocks inline script, style and eval, permits same-origin code and CSSOM styles, omits referrers; framed pages hide`);
  } finally {
    await browser.close();
  }
}
