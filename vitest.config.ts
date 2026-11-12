import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
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
