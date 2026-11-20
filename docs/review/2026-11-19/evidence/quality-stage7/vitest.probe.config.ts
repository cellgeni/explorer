// Review-only: runs one existing test file with the readCsc probe.
//   npx vitest run --config docs/review/2026-11-19/evidence/quality-stage7/vitest.probe.config.ts -t "feature count differs"
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('../../../../..', import.meta.url))

export default defineConfig({
  root,
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/datasets/ateraDataset.test.ts'],
    setupFiles: [
      './src/test/setup.ts',
      './docs/review/2026-11-19/evidence/quality-stage7/ateraCscProbe.setup.ts',
    ],
  },
})
