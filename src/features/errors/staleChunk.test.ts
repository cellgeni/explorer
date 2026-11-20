import { describe, expect, it } from 'vitest'
import { createStructuredLoadError } from './loadErrorModel'
import {
  APP_UPDATED_ACTION,
  installStaleChunkDetection,
  isStaleChunkError,
} from './staleChunk'

const CHUNK = 'https://cellgeni.github.io/explorer/assets/h5adDataset-D3adB33f.js'
const DATASET = 'https://example.org/data/sample.h5ad'
const PAGE = 'https://cellgeni.github.io/explorer/'

describe('stale chunks after a redeploy (EXP-021)', () => {
  it.each([
    ['Chromium', `Failed to fetch dynamically imported module: ${CHUNK}`],
    ['Firefox', `error loading dynamically imported module: ${CHUNK}`],
    ['Safari', 'Importing a module script failed.'],
    ['Vite', 'Unable to preload CSS for /explorer/assets/plots-Bx1.css'],
  ])('reads the %s message as an updated app', (_browser, message) => {
    expect(
      createStructuredLoadError('Dataset overview', new TypeError(message), {
        url: DATASET,
        pageUrl: PAGE,
      }),
    ).toMatchObject({
      code: 'app-updated',
      title: 'The app was updated',
      message,
      action: APP_UPDATED_ACTION,
    })
  })

  it('keeps the network advice for a dataset that fails to load', () => {
    expect(
      createStructuredLoadError('Dataset overview', new TypeError('Failed to fetch'), {
        url: DATASET,
        pageUrl: PAGE,
      }),
    ).toMatchObject({
      code: 'network',
      action: 'Check dataset URL, CORS, and network access.',
    })
  })

  it("names the error of Vite's preload event, whatever its wording", () => {
    const target = new EventTarget()
    const uninstall = installStaleChunkDetection(target)
    const error = new Error('Something else went wrong')
    const event = Object.assign(new Event('vite:preloadError'), { payload: error })

    target.dispatchEvent(event)
    expect(isStaleChunkError(error)).toBe(true)

    uninstall()
    const later = new Error('Something else went wrong')
    target.dispatchEvent(
      Object.assign(new Event('vite:preloadError'), { payload: later }),
    )
    expect(isStaleChunkError(later)).toBe(false)
  })
})
