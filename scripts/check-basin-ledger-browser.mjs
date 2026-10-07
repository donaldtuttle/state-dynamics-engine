/** Check the built site's ledger with an externally installed Playwright browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright-core');
const [url = 'http://127.0.0.1:4173/simulator/', outputDir, launchFile] = process.argv.slice(2);
if (!outputDir) throw new Error('Usage: node scripts/check-basin-ledger-browser.mjs URL OUTPUT_DIR [LAUNCH_OPTIONS_JSON]');
await fs.mkdir(outputDir, {recursive: true});
const launchOptions = launchFile ? JSON.parse(await fs.readFile(launchFile, 'utf8')) : {};
const browser = await chromium.launch({headless: true, ...launchOptions});
const results = [];
try {
  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}, {width: 375, height: 812}]) {
    const page = await browser.newPage({viewport, deviceScaleFactor: 1});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url);
    if (viewport.width < 820) await page.locator('#controls-toggle').click();
    await page.locator('[data-mode="basin"]').click();
    const threshold = page.locator('#projectionThreshold-range');
    await threshold.fill('0.40');
    await threshold.dispatchEvent('change');
    for (let i = 0; i < 40; i++) await page.locator('#step-button').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const download = await downloadPromise;
    const exportPath = path.join(outputDir, `trace-${viewport.width}.json`);
    await download.saveAs(exportPath);
    const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.ok(data.eventHistory.events.length >= 4, 'several projections are required');
    assert.ok(data.eventHistory.events.some(event => event.energyDrop === 0 && event.projectionDistance > 0.01 && event.preHash !== event.postHash));
    if (viewport.width < 820) await page.locator('#controls-toggle').click();
    await page.locator('#tab-trace').click();
    const cards = page.locator('#event-list .event-item');
    assert.equal(await cards.count(), data.eventHistory.events.length);
    for (const [index, event] of data.eventHistory.events.slice().reverse().entries()) {
      assert.equal(await cards.nth(index).locator('.event-delta').innerText(), `State change ${event.projectionDistance.toFixed(3)}`);
      assert.match(await cards.nth(index).locator('.event-norm').innerText(), /^Norm change [+-]?\d+\.\d{3}$/);
    }
    await page.locator('.event-card').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const list = document.querySelector('#event-list');
      const cards = [...list.querySelectorAll('.event-item')];
      const clipped = cards.flatMap(card => [...card.querySelectorAll('header span')].filter(node => {
        const rect = node.getBoundingClientRect(), outer = card.getBoundingClientRect();
        return rect.left < outer.left - 1 || rect.right > outer.right + 1 || node.scrollWidth > node.clientWidth + 1;
      }));
      return {pageWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        ledgerWidth: list.clientWidth, ledgerScrollWidth: list.scrollWidth, clippedMetrics: clipped.length};
    });
    assert.ok(layout.scrollWidth <= layout.pageWidth, JSON.stringify(layout));
    assert.ok(layout.ledgerScrollWidth <= layout.ledgerWidth, JSON.stringify(layout));
    assert.equal(layout.clippedMetrics, 0);
    await page.screenshot({path: path.join(outputDir, `ledger-${viewport.width}.png`)});
    await page.locator('.event-card').screenshot({path: path.join(outputDir, `ledger-card-${viewport.width}.png`)});
    await page.locator('#tab-verify').click();
    await page.locator('#run-checks-button').click();
    await page.waitForFunction(() => document.querySelector('#check-overall').textContent !== 'not run');
    const verification = await page.locator('#check-overall').innerText();
    assert.match(verification, /^(\d+)\/\1 pass$/);
    assert.deepEqual(errors, []);
    results.push({viewport, events: data.eventHistory.events.length, layout, verification, errors,
      zeroDropExample: data.eventHistory.events.find(event => event.energyDrop === 0 && event.projectionDistance > 0.01)});
    await page.close();
  }
  const report = {browser: browser.version(), url, results};
  await fs.writeFile(path.join(outputDir, 'browser-report.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
