import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end test configuration.
 *
 * No E2E specs exist yet — critical learner-flow journeys (registration → login,
 * eligible learner → exam → pass, pass → certificate → verify) are added from
 * Stage 3 onward. This config is in place so those stages only add spec files.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
