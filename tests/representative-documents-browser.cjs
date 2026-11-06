// Synthetic verification images only. No popup, production API or persistent document storage.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<button id="launch">Documents</button>');
    await page.addScriptTag({ content: `
      window.mode='success';window.calls=[];window.gates=[];
      window.open=()=>{throw new Error('Popup must not be used')};
      window.DartAdminApi={request:async url=>{
        calls.push(url);
        if(mode==='hold')await new Promise(resolve=>gates.push(resolve));
        if(mode==='failure'&&url.endsWith('/id_back'))throw new Error('secret internal detail');
        return {document:{dataUrl:mode==='invalid'?'https://untrusted.example.test/private.png':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2QAAAAASUVORK5CYII='}};
      }};
    ` });
    await page.addScriptTag({ content: fs.readFileSync('src/dashboard/core/crm.js', 'utf8') });
    await page.evaluate(() => document.getElementById('launch').onclick = () => { void dartReviewRepresentativeDocuments('REP/fixture'); });
    await page.click('#launch');
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] img').length === 3);
    assert.equal(page.context().pages().length, 1);
    assert.equal(await page.locator('dialog[open]').evaluate(el => el.getBoundingClientRect().width <= innerWidth), true);
    assert.equal(await page.evaluate(() => calls.every(url => url.includes('REP%2Ffixture'))), true);
    const image = await page.locator('dialog img').first().elementHandle();
    await page.locator('dialog button', { hasText: 'Close' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog'));
    assert.equal(await image.getAttribute('src'), null, 'close scrubs image bytes from detached DOM');
    await page.evaluate(() => { mode = 'failure'; });
    await page.click('#launch');
    await page.getByRole('button', { name: 'Retry' }).waitFor();
    assert.equal(await page.locator('dialog img').count(), 2, 'one failure does not hide the other documents');
    assert.doesNotMatch(await page.locator('dialog').textContent(), /secret internal detail/);
    await page.evaluate(() => { mode = 'success'; });
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog img').length === 3);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    await page.evaluate(() => { mode = 'hold'; });
    await page.click('#launch');
    await page.getByText('Loading verification documents…').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('dart:admin-logged-out')));
    await page.waitForFunction(() => !document.querySelector('dialog'));
    await page.evaluate(() => { gates.splice(0).forEach(resolve => resolve()); });
    assert.equal(await page.locator('img').count(), 0, 'late responses cannot reopen a closed private viewer');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { mode = 'invalid'; });
    await page.click('#launch');
    await page.getByRole('button', { name: 'Retry' }).waitFor();
    assert.equal(await page.locator('dialog img').count(), 0, 'external document URLs are never embedded');
    await page.keyboard.press('Escape');
    console.log('PASS representative verification viewer: native dialog, mobile/desktop, no popups, protected API, partial failure/retry, Escape, logout, secret cleanup and late-response isolation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
