// Review-only Playwright config: same as playwright.config.ts but on port 4273
// with no server reuse, so another worktree's preview on 4173 cannot answer.
import { fileURLToPath } from 'node:url'

// Repository root, five levels up from this file.
const root = fileURLToPath(new URL('../../../../..', import.meta.url)).replace(/\/$/, '')
export default {
  testDir: root + '/tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.PW_OUT || '/tmp/pw-out',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    trace: 'on-first-retry',
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4273 --strictPort',
    cwd: root,
    port: 4273,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
}
