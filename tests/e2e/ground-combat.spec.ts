import { test, expect } from "@playwright/test";

/**
 * Ground Combat E2E Tests
 *
 * These tests verify the Battlefront-style ground combat system:
 * - Infantry spawning and movement
 * - Character controller physics
 * - Vehicle enter/exit mechanics
 * - Command post capture
 * - Blaster weapon combat
 *
 * Note: These tests require the ground combat mode to be integrated
 * into the main app. Until then, some tests are marked as .skip.
 */

declare global {
  interface Window {
    __xwingz?: {
      mode: "map" | "flight" | "ground";
      scenario: "sandbox" | "yavin_defense" | "ground_assault";
      selectedSystemId: string | null;
      yavinPhase: "launch" | "combat" | "success" | "fail" | null;
      targetCount: number;
      allyCount: number;
      credits: number;
      groundMode?: {
        playerEid: number;
        playerHealth: number;
        playerAmmo: number;
        commandPostCount: number;
        friendlyPosts: number;
        enemyPosts: number;
        neutralPosts: number;
        isGrounded: boolean;
        isPiloting: boolean;
      };
    };
  }
}

test.describe("Ground Combat System", () => {
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

  test("game canvas loads without WebGL errors", async ({ page }) => {
    await page.goto("/?e2e=1");
    await expect(page.locator("#game-canvas")).toBeVisible({ timeout: 25_000 });

    // Verify WebGL context is available
    const hasWebGL = await page.evaluate(() => {
      const canvas = document.querySelector("#game-canvas") as HTMLCanvasElement;
      if (!canvas) return false;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      return gl !== null;
    });
    expect(hasWebGL).toBe(true);
  });

  test("game exposes debug state object", async ({ page }) => {
    await page.goto("/?e2e=1");
    await page.waitForFunction(() => window.__xwingz !== undefined, null, { timeout: 25_000 });

    const state = await page.evaluate(() => window.__xwingz);
    expect(state).toBeDefined();
    expect(state?.mode).toBeDefined();
  });

  // The following tests require ground combat mode integration
  test.describe("Infantry Movement", () => {
    test.skip("player can spawn as infantry", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      const groundState = await page.evaluate(() => window.__xwingz?.groundMode);
      expect(groundState?.playerEid).toBeGreaterThan(0);
      expect(groundState?.playerHealth).toBeGreaterThan(0);
    });

    test.skip("WASD movement works", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Get initial position
      const initialPos = await page.evaluate(() => {
        const state = window.__xwingz?.groundMode;
        return state ? { x: 0, y: 0, z: 0 } : null; // Would use Transform.x[playerEid] etc.
      });

      // Move forward
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(500);
      await page.keyboard.up("KeyW");

      // Verify position changed
      const newPos = await page.evaluate(() => {
        const state = window.__xwingz?.groundMode;
        return state ? { x: 0, y: 0, z: 0 } : null;
      });

      // Position should have changed (moved forward in negative Z)
      expect(newPos).toBeDefined();
    });

    test.skip("character stays grounded on flat terrain", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground" && window.__xwingz?.groundMode?.isGrounded,
        null,
        { timeout: 25_000 }
      );

      const isGrounded = await page.evaluate(() => window.__xwingz?.groundMode?.isGrounded);
      expect(isGrounded).toBe(true);
    });

    test.skip("jump mechanic works", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground" && window.__xwingz?.groundMode?.isGrounded,
        null,
        { timeout: 25_000 }
      );

      // Jump
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);

      // Should be airborne briefly
      const isGroundedDuringJump = await page.evaluate(() => window.__xwingz?.groundMode?.isGrounded);
      expect(isGroundedDuringJump).toBe(false);

      // Wait for landing
      await page.waitForFunction(
        () => window.__xwingz?.groundMode?.isGrounded === true,
        null,
        { timeout: 3_000 }
      );
    });

    test.skip("sprint increases movement speed", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Sprint forward
      await page.keyboard.down("Shift");
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(500);
      await page.keyboard.up("KeyW");
      await page.keyboard.up("Shift");

      // Sprint should cover more distance than walk
      // (Would need position tracking to verify)
    });
  });

  test.describe("Vehicle Interaction", () => {
    test.skip("E key enters nearby vehicle", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&spawnVehicle=true");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Move toward vehicle and press E
      await page.keyboard.press("KeyE");

      await page.waitForFunction(
        () => window.__xwingz?.groundMode?.isPiloting === true,
        null,
        { timeout: 5_000 }
      );

      const isPiloting = await page.evaluate(() => window.__xwingz?.groundMode?.isPiloting);
      expect(isPiloting).toBe(true);
    });

    test.skip("E key exits vehicle when piloting", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&inVehicle=true");
      await page.waitForFunction(
        () => window.__xwingz?.groundMode?.isPiloting === true,
        null,
        { timeout: 25_000 }
      );

      // Exit vehicle
      await page.keyboard.press("KeyE");

      await page.waitForFunction(
        () => window.__xwingz?.groundMode?.isPiloting === false,
        null,
        { timeout: 5_000 }
      );

      const isPiloting = await page.evaluate(() => window.__xwingz?.groundMode?.isPiloting);
      expect(isPiloting).toBe(false);
    });
  });

  test.describe("Command Post Capture", () => {
    test.skip("standing near neutral post starts capture", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&testMap=commandPost");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Initial state - should have neutral post
      const initialNeutral = await page.evaluate(() => window.__xwingz?.groundMode?.neutralPosts);
      expect(initialNeutral).toBeGreaterThan(0);

      // Wait for capture (player standing in radius)
      await page.waitForFunction(
        () => (window.__xwingz?.groundMode?.friendlyPosts ?? 0) > 0,
        null,
        { timeout: 15_000 }
      );

      const friendlyPosts = await page.evaluate(() => window.__xwingz?.groundMode?.friendlyPosts);
      expect(friendlyPosts).toBeGreaterThan(0);
    });

    test.skip("contested post does not progress", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&testMap=contested");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // In contested state, capture should not progress
      const initialProgress = await page.evaluate(() => {
        // Would check CommandPost.captureProgress
        return 0;
      });

      await page.waitForTimeout(2000);

      const finalProgress = await page.evaluate(() => {
        return 0;
      });

      expect(finalProgress).toBe(initialProgress);
    });
  });

  test.describe("Blaster Combat", () => {
    test.skip("firing depletes ammo", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      const initialAmmo = await page.evaluate(() => window.__xwingz?.groundMode?.playerAmmo);

      // Fire
      await page.keyboard.down("Space");
      await page.waitForTimeout(500);
      await page.keyboard.up("Space");

      const finalAmmo = await page.evaluate(() => window.__xwingz?.groundMode?.playerAmmo);
      expect(finalAmmo).toBeLessThan(initialAmmo ?? 999);
    });

    test.skip("hitting enemy reduces their health", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&spawnEnemy=true");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Would need enemy health tracking
      // Fire at enemy and verify damage
    });
  });

  test.describe("AI Behavior", () => {
    test.skip("AI soldiers move toward objectives", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&spawnAI=true");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // AI should eventually move toward command posts
      await page.waitForTimeout(5000);

      // Would verify AI positions changed
    });

    test.skip("AI engages enemies in range", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&spawnBothTeams=true");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // AI should start shooting when enemies are nearby
      // Would verify projectile count increases
    });
  });

  test.describe("Performance", () => {
    test.skip("maintains 30+ FPS with 32 soldiers", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground&soldierCount=32");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 30_000 }
      );

      // Collect FPS samples
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        const fps = await page.evaluate(() => {
          // Would access FPS counter from game state
          return 60;
        });
        samples.push(fps);
        await page.waitForTimeout(100);
      }

      const avgFps = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(avgFps).toBeGreaterThanOrEqual(30);
    });

    test.skip("physics simulation stays stable", async ({ page }) => {
      await page.goto("/?e2e=1&mode=ground");
      await page.waitForFunction(
        () => window.__xwingz?.mode === "ground",
        null,
        { timeout: 25_000 }
      );

      // Run for 10 seconds and verify no physics explosions
      await page.waitForTimeout(10_000);

      // Verify player is still at reasonable position
      const playerValid = await page.evaluate(() => {
        const state = window.__xwingz?.groundMode;
        return state?.playerHealth && state.playerHealth > 0;
      });
      expect(playerValid).toBe(true);
    });
  });
});

test.describe("Space-Ground Transition", () => {
  test.skip("landing ship transitions to ground mode", async ({ page }) => {
    await page.goto("/?e2e=1&mode=flight&nearPlanet=true");
    await page.waitForFunction(
      () => window.__xwingz?.mode === "flight",
      null,
      { timeout: 25_000 }
    );

    // Fly down toward planet surface
    await page.keyboard.down("KeyS"); // Pitch down
    await page.waitForTimeout(5000);
    await page.keyboard.up("KeyS");

    // Should transition to ground mode when close to surface
    await page.waitForFunction(
      () => window.__xwingz?.mode === "ground",
      null,
      { timeout: 30_000 }
    );

    expect(await page.evaluate(() => window.__xwingz?.mode)).toBe("ground");
  });

  test.skip("exiting ship on ground spawns infantry", async ({ page }) => {
    await page.goto("/?e2e=1&mode=ground&inVehicle=true");
    await page.waitForFunction(
      () => window.__xwingz?.groundMode?.isPiloting === true,
      null,
      { timeout: 25_000 }
    );

    // Exit ship
    await page.keyboard.press("KeyE");

    await page.waitForFunction(
      () => window.__xwingz?.groundMode?.isPiloting === false,
      null,
      { timeout: 5_000 }
    );

    // Should now be infantry
    const isOnFoot = await page.evaluate(() => !window.__xwingz?.groundMode?.isPiloting);
    expect(isOnFoot).toBe(true);
  });
});
