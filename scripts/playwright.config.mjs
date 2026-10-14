import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.browsers');
// PORT moves both the server and the suite: another local project often
// holds 4173, and reuseExistingServer would then test the wrong app.
const base = 'http://127.0.0.1:' + (+process.env.PORT || 4173);
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: base, serviceWorkers: 'block', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', testIgnore: /mobile.spec.mjs/, use: { browserName: 'firefox' } }
  ],
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node serve.mjs', url: base, reuseExistingServer: true }
});
