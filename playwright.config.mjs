import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.E2E_PORT || 8769);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // The lightweight Python static server has a small connection backlog.
  workers: 1,
  reporter: 'list',
  outputDir: process.env.E2E_OUTPUT_DIR || join(tmpdir(), 'interview-questions-playwright'),
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: `python3 scripts/serve_local.py --port ${port}`,
    url: baseURL,
    stderr: 'ignore',
    reuseExistingServer: !process.env.CI
  }
});
