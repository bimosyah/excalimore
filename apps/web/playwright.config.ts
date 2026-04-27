import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Run tests serially to avoid races on the shared dev DB; tests truncate
  // tables between runs (see e2e/fixtures.ts) and that is not safe under
  // parallel execution.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @excalimore/api dev',
      cwd: '../..',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Tests exercise signup/login dozens of times; the production-default
      // 5/min IP rate limit would trip the suite. Bump for the test process.
      env: { RATE_LIMIT_LOGIN: '1000' },
    },
    {
      command: 'pnpm --filter @excalimore/web dev',
      cwd: '../..',
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
