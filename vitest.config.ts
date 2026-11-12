import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// V8 coverage slows the App tests enough on CI's 4-vCPU runner that they
// overrun the 5 s test and 1 s waitFor/findBy defaults (CI #94–#99). A
// coverage run gives them longer; `npm test` keeps the defaults.
const coverageRun = process.argv.includes('--coverage')

export default defineConfig({
  plugins: [react()],
  test: {
    ...(coverageRun
      ? { testTimeout: 30_000, env: { TESTING_LIBRARY_ASYNC_TIMEOUT_MS: '5000' } }
      : {}),
    environment: 'jsdom',
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      'old/**',
      'private/**',
      'tests/e2e/**',
    ],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Runs with `npm run test:coverage` (or `vitest --coverage`), not `npm test`.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      // About a point under the 2026-11-12 baseline (86.1% statements, 75.3%
      // branches, 89.4% functions, 86.1% lines), so a drop fails CI.
      thresholds: {
        statements: 85,
        branches: 74,
        functions: 88,
        lines: 85,
      },
    },
  },
})
