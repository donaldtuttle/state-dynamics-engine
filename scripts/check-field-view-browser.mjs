/** Pixel smoke checks for the built Field view, not a golden-image comparison.
 * Uses the same externally installed Playwright browser as the ledger check.
 * Example: NODE_PATH="$PWD/experiments/memory-policy-v3/node_modules" node
 * scripts/check-field-view-browser.mjs http://127.0.0.1:4173/simulator/ /tmp/field-evidence
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)('playwright-core');
const [url = 'http://127.0.0.1:4173/simulator/', outputDir, launchFile] = process.argv.slice(2);
if (!outputDir) throw new Error('Usage: node scripts/check-field-view-browser.mjs URL OUTPUT_DIR [LAUNCH_OPTIONS_JSON]');
await fs.mkdir(outputDir, {recursive: true});
const launchOptions = launchFile ? JSON.parse(await fs.readFile(launchFile, 'utf8')) : {};
const browser = await chromium.launch({headless: true, ...launchOptions});
const layers = [
  {name: 'Basin projection', radius: 0.38},
  {name: 'Memory influence', radius: 0.58},
  {name: 'History summaries', radius: 0.78},
  {name: 'Adaptive noise', radius: 0.98},
];
const results = [];

// Two callbacks let the renderer's queued animation frame paint first, without
// a fixed-duration sleep, a target frame count, or a flash-timing assertion.
async function afterPaint(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function sampleState(page) {
  return page.locator('#field-canvas').evaluate(canvas => {
    const {width, height} = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const radius = Math.min(width, height) * 0.46;
    let visible = 0;
    let gold = 0;
    // Look in the state band, excluding the hub and canvas edge. Transparent
    // pixels and the near-black page cannot satisfy this stroke-color check.
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const r = Math.hypot(x - width / 2, y - height / 2) / radius;
        if (r < 0.35 || r > 0.97) continue;
        const i = (y * width + x) * 4;
        const [red, green, blue, alpha] = pixels.subarray(i, i + 4);
        if (alpha > 100 && red + green + blue > 180) visible++;
        // Bright cream/gold distinguishes the state stroke from the darker
        // projection ring, translucent hub and copper motes.
        if (alpha > 180 && red > 220 && green > 190 && blue < green * 0.9 && red >= green) gold++;
      }
    }
    return {width, height, visible, gold};
  });
}

async function sampleRing(page, fraction) {
  return page.locator('#field-canvas').evaluate((canvas, fraction) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const radius = Math.min(canvas.width, canvas.height) * 0.46;
    // Sample only a small patch around this ring's 12 o'clock tick.
    const size = Math.max(3, Math.round(10 * dpr));
    const x = Math.round(canvas.width / 2 - size / 2);
    const y = Math.round(canvas.height / 2 - radius * fraction - size / 2);
    return Array.from(canvas.getContext('2d').getImageData(x, y, size, size).data);
  }, fraction);
}

function changedPixels(a, b) {
  let changed = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    // Ignore sub-pixel rounding; no fixture, exact image, particle, or state hash.
    const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
      + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
    if (delta > 24) changed++;
  }
  return changed;
}

try {
  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}, {width: 375, height: 812}]) {
    const page = await browser.newPage({viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference'});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.goto(url);
      await page.locator('#step-button').click();
      await afterPaint(page);
      const normal = await sampleState(page);
      assert.ok(normal.visible > 8 && normal.gold > 8, 'Field must draw a visible gold state after one step: ' + JSON.stringify(normal));
      await page.locator('.stage-card').scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(outputDir, 'field-' + viewport.width + '.png')});
      await page.locator('.stage-card').screenshot({path: path.join(outputDir, 'field-card-' + viewport.width + '.png')});

      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.locator('#reset-button').click();
      await page.locator('#step-button').click();
      await afterPaint(page);
      const reduced = await sampleState(page);
      assert.ok(reduced.visible > 8 && reduced.gold > 8, 'Reduced motion must still paint the state on the next frame: ' + JSON.stringify(reduced));
      await page.locator('.stage-card').screenshot({path: path.join(outputDir, 'field-reduced-' + viewport.width + '.png')});

      // Toggle at the unchanged reset state, with reduced motion to isolate the
      // rings from easing/motes. This uses only existing UI controls, not engine
      // internals, injected state, a changed seed, or exports.
      await page.locator('#reset-button').click();
      if (viewport.width < 820) await page.locator('#controls-toggle').click();
      const ringChanges = [];
      for (const layer of layers) {
        const row = page.locator('.switch-row').filter({hasText: layer.name});
        const label = await row.locator('span').evaluate(span => span.childNodes[0].textContent.trim());
        assert.equal(label, layer.name);
        const chip = page.locator('.mechanism-chip').filter({hasText: layer.name});
        assert.equal(await chip.textContent(), layer.name);
        const toggle = row.getByRole('checkbox');
        await toggle.uncheck();
        await afterPaint(page);
        const off = await sampleRing(page, layer.radius);
        await toggle.check();
        await afterPaint(page);
        const on = await sampleRing(page, layer.radius);
        const changed = changedPixels(off, on);
        assert.ok(changed > 4, layer.name + ' must visibly change its own ring');
        ringChanges.push({name: layer.name, changedPixels: changed});
      }
      assert.deepEqual(errors, []);
      results.push({viewport, normal, reduced, ringChanges, errors});
    } catch (error) {
      await page.screenshot({path: path.join(outputDir, 'field-failure-' + viewport.width + '.png')}).catch(() => {});
      throw error;
    } finally {
      await page.close();
    }
  }
  const report = {browser: browser.version(), url, results};
  await fs.writeFile(path.join(outputDir, 'field-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
