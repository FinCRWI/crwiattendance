const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.BASE_URL || "http://localhost:8080";

module.exports = defineConfig({
  testDir: "./tests/smoke",
  // The RUN_LIVE=1 specs log into the real Firebase backend as Demo and
  // mutate her actual plans, so they must never run in parallel with each
  // other — concurrent writes to the same plan docs race and flake.
  workers: process.env.RUN_LIVE === "1" ? 1 : undefined,
  timeout: 30000,
  expect: {
    timeout: 7000
  },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "powershell -NoProfile -ExecutionPolicy Bypass -File ./test_server.ps1",
    url: `${baseURL}/index.html`,
    timeout: 120000,
    reuseExistingServer: true
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});

