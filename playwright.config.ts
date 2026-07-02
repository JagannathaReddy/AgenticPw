import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND?.trim();
const webServerUrl = process.env.PLAYWRIGHT_WEB_SERVER_URL?.trim() ?? baseURL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    ...(baseURL ? { baseURL } : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  ...(webServerCommand && webServerUrl
    ? {
        webServer: {
          command: webServerCommand,
          url: webServerUrl,
          reuseExistingServer: !process.env.CI,
        },
      }
    : {}),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
