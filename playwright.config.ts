import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist"
      ]
    }
  },
  webServer: {
    command: "npm --workspace apps/web run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
