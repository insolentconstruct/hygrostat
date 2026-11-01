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
    console.log(`PASS ${name}: real CSP blocks inline/eval, permits same-origin code, and omits referrers`);
  } finally {
    await browser.close();
  }
}
