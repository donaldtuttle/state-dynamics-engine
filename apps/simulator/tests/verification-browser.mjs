/** Regression check using only the simulator's visible controls and output.
 * Accepts a Playwright Page or the cloud browser's Playwright API.
 */
import assert from "node:assert/strict";

export async function checkVerificationLifecycle(page) {
  const observe = async () => {
    if (page.domSnapshot) await page.domSnapshot();
    else await page.locator("body").innerText();
  };
  const results = [];
  const act = async (action) => {
    await observe();
    await action();
    await observe();
  };
  const click = async (name) => act(() => page.getByRole("button", { name, exact: true }).click());
  const verify = async () => {
    await click("Run checks");
    await page.locator(".check-item").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#check-overall").innerText(), "8/8 pass");
    const seed = await page.getByRole("textbox", { name: "Simulation seed", exact: true })
      .evaluate((input) => input.value);
    const tick = await page.locator("#status-tick").innerText();
    const hash = await page.locator("#status-hash").innerText();
    assert.equal(await page.locator("#check-context").innerText(),
      `Checked seed ${seed} at tick ${tick}; state hash ${hash}.`);
  };
  const cleared = async (name) => {
    await page.getByText("not run", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator(".check-item").count(), 0, name);
    assert.doesNotMatch(await page.locator("#check-context").innerText(), /Checked seed/);
    results.push(name);
  };

  await observe();
  await act(() => page.getByRole("tab", { name: "Verification", exact: true }).click());
  if (await page.getByRole("button", { name: "Show parameters", exact: true }).isVisible()) {
    await click("Show parameters");
  }
  await click("Reset simulation");
  await cleared("initial state");
  await verify();
  await click("Reset simulation");
  await cleared("reset at tick zero");
  await verify();
  await click("Step one tick");
  await cleared("single step");
  await verify();
  await click("Reset simulation");
  await cleared("reset after stepping");
  assert.equal(await page.locator("#status-tick").innerText(), "0");
  assert.equal(await page.locator("#summary-frames").innerText(), "0");

  await verify();
  await click("Generate a new seed");
  await cleared("new seed button");
  await verify();
  const seedInput = page.getByRole("textbox", { name: "Simulation seed", exact: true });
  await act(() => seedInput.fill("verification-regression"));
  await act(() => seedInput.press("Tab"));
  await cleared("typed seed");

  for (const label of ["Projection threshold", "Update scale", "Adaptive noise amplitude"]) {
    await verify();
    const slider = page.getByRole("slider", { name: label, exact: true });
    await act(() => slider.press("ArrowRight"));
    await act(() => slider.press("Tab"));
    await cleared(label);
  }
  for (const label of [
    "Basin projection threshold projection + event",
    "Memory influence recall a similar history summary",
    "History summaries store averaged state history",
    "Adaptive noise seeded Gaussian input sample",
  ]) {
    await verify();
    const toggle = page.getByRole("checkbox", { name: label, exact: true });
    await act(() => toggle.uncheck());
    await cleared(label);
    await act(() => toggle.check());
  }
  await click("periodic");
  await verify();
  await click("quiet");
  await cleared("input mode");
  await verify();
  await click("Queue input pulse");
  await cleared("queued pulse");

  await verify();
  await act(() => page.getByRole("tab", { name: "Field", exact: true }).click());
  await act(() => page.getByRole("tab", { name: "Verification", exact: true }).click());
  assert.equal(await page.locator("#check-overall").innerText(), "8/8 pass");
  const interval = page.getByRole("slider", { name: "Tick interval in milliseconds", exact: true });
  await act(() => interval.press("ArrowRight"));
  assert.equal(await page.locator("#check-overall").innerText(), "8/8 pass");
  results.push("navigation and interval preserve results");

  await click("Play simulation");
  await page.getByText("not run", { exact: true }).waitFor({ state: "visible" });
  await click("Pause simulation");
  await cleared("playback advancement");
  await verify();
  results.push("rerun without reloading");
  return results;
}
