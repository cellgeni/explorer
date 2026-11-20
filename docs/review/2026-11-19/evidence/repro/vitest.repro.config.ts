// Runs the review's reproductions (*.repro.ts) against the reviewed source:
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts
// They are not part of `npm test`, whose pattern matches only *.test.* files.
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('../../../../..', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['docs/review/2026-11-19/evidence/repro/**/*.repro.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
