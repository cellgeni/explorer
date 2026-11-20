// What a user sees when a lazily imported chunk is missing, as after a Pages
// deploy replaces the hashed assets under an open tab. Chromium rejects a
// dynamic import whose module 404s with
//   TypeError: Failed to fetch dynamically imported module: <chunk URL>
// (Firefox: "error loading dynamically imported module"; Safari: "Importing a
// module script failed."). The dataset URL itself is fine.
// Expected (product contract implied by docs/architecture.md error advice):
// advice that matches the cause, i.e. reload the app, not "check CORS".
import { describe, expect, it } from 'vitest'
import { createStructuredLoadError } from '../../../../../../src/features/errors/loadErrorModel'

const CHUNK = 'https://cellgeni.github.io/explorer/assets/h5adDataset-D3adB33f.js'
const DATASET = 'https://example.org/data/sample.h5ad'
const PAGE = 'https://cellgeni.github.io/explorer/'

describe('stale lazy chunk after a redeploy', () => {
  for (const [browser, message] of [
    ['Chromium', `Failed to fetch dynamically imported module: ${CHUNK}`],
    ['Firefox', `error loading dynamically imported module: ${CHUNK}`],
    ['Safari', 'Importing a module script failed.'],
  ] as const) {
    it(`${browser}: classified as`, () => {
      const result = createStructuredLoadError(
        'Dataset overview',
        new TypeError(message),
        {
          url: DATASET,
          pageUrl: PAGE,
        },
      )
      console.log(
        browser,
        JSON.stringify({ code: result.code, title: result.title, action: result.action }),
      )
      // Records the current behaviour: dataset/CORS advice, nothing about reloading.
      expect(result.code).toBe('network')
      expect(result.action).toMatch(/CORS/)
      expect(result.action).not.toMatch(/reload/i)
    })
  }
})
