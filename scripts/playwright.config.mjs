import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.browsers');
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', launchOptions: { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', testIgnore: /mobile.spec.mjs/, use: { browserName: 'firefox' } }
  ],
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});
