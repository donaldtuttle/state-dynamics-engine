/** Check verification freshness in the built desktop and mobile simulator. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { checkVerificationLifecycle } from "../apps/simulator/tests/verification-browser.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const [url = "http://127.0.0.1:4173/simulator/", outputDir, launchFile] = process.argv.slice(2);
if (!outputDir) throw new Error("Usage: node scripts/check-verification-browser.mjs URL OUTPUT_DIR [LAUNCH_OPTIONS_JSON]");
await fs.mkdir(outputDir, { recursive: true });
const launchOptions = launchFile ? JSON.parse(await fs.readFile(launchFile, "utf8")) : {};
const browser = await chromium.launch({ headless: true, ...launchOptions });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
      await page.goto(url);
      const checks = await checkVerificationLifecycle(page);
      const context = await page.locator("#check-context").innerText();
      const layout = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(outputDir, `verification-${viewport.width}.png`) });
      results.push({ viewport, checks, context, layout, errors });
    } catch (error) {
      await page.screenshot({ path: path.join(outputDir, `failure-${viewport.width}.png`) }).catch(() => {});
      throw error;
    } finally {
      await page.close();
    }
  }
  const report = { browser: browser.version(), url, results };
  await fs.writeFile(path.join(outputDir, "verification-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
