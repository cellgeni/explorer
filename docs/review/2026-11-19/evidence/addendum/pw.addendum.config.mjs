// Addendum (2026-11-20) browser checks. Servers on review ports only, never
// reused, so no other worktree's server answers:
//   4273  vite preview of the merged build (dist/)
//   4274  scripts/range-server.mjs over evidence/fixtures/addendum
// Run from the repository root after npm run build:
//   npx playwright test --config docs/review/2026-11-19/evidence/addendum/pw.addendum.config.mjs
import { fileURLToPath } from 'node:url'

// Repository root, five levels up from this file.
const root = fileURLToPath(new URL('../../../../..', import.meta.url)).replace(/\/$/, '')
const here = fileURLToPath(new URL('./', import.meta.url))

export default {
  testDir: here,
  testMatch: /.*\.add\.mjs$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [['list']],
  outputDir: process.env.PW_OUT || '/tmp/pw-out-addendum',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: [
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4273 --strictPort',
      cwd: root,
      port: 4273,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/range-server.mjs ${here}../fixtures/addendum --port 4274`,
      cwd: root,
      port: 4274,
      reuseExistingServer: false,
    },
  ],
}
