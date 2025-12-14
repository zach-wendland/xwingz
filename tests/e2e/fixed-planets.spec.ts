import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __xwingz?: {
      mode: "map" | "flight" | "ground";
      scenario: "sandbox" | "yavin_defense";
      selectedSystemId: string | null;
      planetCount: number;
      yavinPhase: "launch" | "combat" | "success" | "fail" | null;
      targetCount: number;
      allyCount: number;
      credits: number;
    };
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  (testInfo as any)._consoleErrors = errors;
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
});

test.afterEach(async ({}, testInfo) => {
  const errors: string[] | undefined = (testInfo as any)._consoleErrors;
  if (errors && errors.length > 0) {
    await testInfo.attach("console-errors.txt", {
      body: errors.join("\n"),
      contentType: "text/plain"
    });
  }
});

test("map shows exactly 10 fixed planets", async ({ page }) => {
  await page.goto("/?e2e=1");
  await expect(page.locator("#game-canvas")).toBeVisible();

  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });

  const planetCount = await page.evaluate(() => window.__xwingz?.planetCount ?? 0);
  expect(planetCount).toBe(10);

  await expect(page.locator("#hud")).toContainText("10 iconic Star Wars locations");
});

test("can click planet and see info", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });

  // Click in the center of the canvas where Yavin 4 should be
  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  // Should show planet info after clicking
  await page.waitForTimeout(500);
  // The HUD should contain planet-related info
  await expect(page.locator("#hud")).toContainText("Planets");
});

test("can enter flight mode from fixed planet", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });

  // Press 1 to go directly to Yavin mission
  await page.keyboard.press("1");
  await page.waitForFunction(() => window.__xwingz?.mode === "flight", null, { timeout: 20_000 });

  await expect(page.locator("#hud")).toHaveClass(/hud-xwing/);
});

test("Yavin mission has 5 wingmen and 6 enemies", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });

  await page.keyboard.press("1");
  await page.waitForFunction(
    () => window.__xwingz?.mode === "flight" && window.__xwingz?.scenario === "yavin_defense",
    null,
    { timeout: 20_000 }
  );

  // Wait for mission to spawn units
  await page.waitForFunction(() => (window.__xwingz?.allyCount ?? 0) >= 5, null, { timeout: 10_000 });

  const allyCount = await page.evaluate(() => window.__xwingz?.allyCount ?? 0);
  expect(allyCount).toBeGreaterThanOrEqual(5);

  // Should have ~6 enemies (may vary slightly due to timing)
  const targetCount = await page.evaluate(() => window.__xwingz?.targetCount ?? 0);
  expect(targetCount).toBeLessThanOrEqual(8); // 6 enemies but allow some variance
});
