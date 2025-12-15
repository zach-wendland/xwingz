import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __xwingz?: {
      mode: "map" | "flight";
      scenario: "sandbox" | "yavin_defense";
      selectedSystemId: string | null;
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

test("map loads and starts Yavin defense mission", async ({ page }) => {

  await page.goto("/?e2e=1");
  await expect(page.locator("#game-canvas")).toBeVisible();

  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });
  await expect(page.locator("#hud")).toContainText("galaxy map");

  await page.keyboard.press("1");
  await page.waitForFunction(() => window.__xwingz?.mode === "flight" && window.__xwingz?.scenario === "yavin_defense", null, {
    timeout: 20_000
  });
  await expect(page.locator("#hud")).toHaveClass(/hud-xwing/);
  await expect(page.locator("#hud-mission")).toContainText("DEFEND");

  // Wingmen + enemies spawn (Yavin spawns 6 TIEs).
  await page.waitForFunction(() => (window.__xwingz?.allyCount ?? 0) >= 3, null, { timeout: 10_000 });
  await page.waitForFunction(() => (window.__xwingz?.targetCount ?? 0) >= 6, null, { timeout: 10_000 });

  // Target cycle works and projectiles spawn while firing.
  await page.locator("#game-canvas").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("KeyT");
  await page.waitForFunction(() => {
    const el = document.querySelector("#hud-target");
    const txt = el?.textContent ?? "";
    return txt.includes("TGT");
  }, null, { timeout: 8_000 });

  await page.keyboard.down("Space");
  await page.waitForFunction(() => (window.__xwingz?.projectileCount ?? 0) > 0, null, { timeout: 5_000 });
  await page.keyboard.up("Space");

  // Return to map
  await page.keyboard.press("m");
  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 15_000 });
  await expect(page.locator("#hud")).toContainText("galaxy map");
});

test("Yavin mission can reach success/fail states (e2e debug)", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__xwingz?.mode === "map", null, { timeout: 25_000 });
  await page.keyboard.press("1");
  await page.waitForFunction(() => window.__xwingz?.mode === "flight" && window.__xwingz?.scenario === "yavin_defense", null, {
    timeout: 20_000
  });
  await page.waitForFunction(() => window.__xwingz?.yavinPhase === "combat", null, { timeout: 10_000 });

  // Success
  await page.evaluate(() => (window as any).__xwingzTest?.killAllEnemies());
  await page.waitForFunction(() => window.__xwingz?.yavinPhase === "success", null, { timeout: 10_000 });
  await expect(page.locator("#hud-mission")).toContainText("VICTORY");

  // Restart
  await page.keyboard.press("h");
  await page.waitForFunction(() => window.__xwingz?.yavinPhase === "combat", null, { timeout: 15_000 });

  // Fail
  await page.evaluate(() => (window as any).__xwingzTest?.failBase());
  await page.waitForFunction(() => window.__xwingz?.yavinPhase === "fail", null, { timeout: 10_000 });
  await expect(page.locator("#hud-mission")).toContainText("FAILED");
});
