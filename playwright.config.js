import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/repl',
  timeout: 30000,
  webServer: {
    command: 'npx serve . -p 3456',
    port: 3456,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:3456',
    // Capture trace on failure for debugging
    trace: 'on-first-retry',
    // Screenshot on failure
    screenshot: 'only-on-failure',
  },
  // Retry once to capture trace
  retries: 1,
});
