import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "../server.mjs";
await mkdir("artifacts", { recursive: true });
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const checks = [],
  errors = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 1080 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .locator("#graph-count")
    .filter({ hasText: "partial map" })
    .waitFor();
  assert.equal(
    await page.locator('#graph-svg [data-node="invoice:499"]').count(),
    0,
  );
  checks.push(
    "Partial graph discloses missing coverage without exposing a denied invoice",
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(await page.locator("#zoom-label").textContent(), "120%");
  const node = page.locator('#graph-svg [data-node="invoice:401"]');
  await node.focus();
  await page.keyboard.press("Enter");
  await page
    .locator("#graph-preview h2")
    .filter({ hasText: "INV-0401" })
    .waitFor();
  checks.push("Zoom and keyboard node inspection");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page.locator("#graph-key").fill("invoice:499");
  await page.getByRole("button", { name: "Trace relationships" }).click();
  await page.locator("#notice").filter({ hasText: "unavailable" }).waitFor();
  assert.equal(await page.locator("#graph-svg [data-node]").count(), 0);
  assert.equal(await page.locator("#graph-preview h2").count(), 0);
  checks.push("Denied root clears previous graph and record preview");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  checks.push("390px layout has no document overflow");
  const offline = await browser.newPage();
  offline.setDefaultTimeout(10000);
  offline.on("pageerror", (e) => errors.push(e.message));
  const requests = [];
  offline.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await offline.goto(pathToFileURL(resolve("dist/demo.html")).href);
  await offline
    .locator("#graph-count")
    .filter({ hasText: "partial map" })
    .waitFor();
  await offline
    .locator("#graph-preview h2")
    .filter({ hasText: "SO-0201" })
    .waitFor();
  assert.deepEqual(requests, []);
  checks.push(
    "Standalone demo completes the main workflow without network requests",
  );
  assert.deepEqual(errors, []);
  checks.push("No browser JavaScript errors");
  const evidence = {
    date: new Date().toISOString(),
    browser: browser.version(),
    checks,
    errors,
    scope:
      "Standalone fictional-data workflows. Native NetSuite validation not performed.",
  };
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
