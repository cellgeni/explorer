import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { clearFetchActivity, configureFetchRetry } from '../data/fetchRetry'
import { clearHostResponses } from '../data/hostResponses'

// Reads tried again after a failed fetch go at once; the back-off is real
// time that tests of failures would wait out. Test files in other threads
// must not hear of each other's bytes.
configureFetchRetry({ retryDelayMs: () => 0, shareActivity: false })
// fetchWithRetry notes how each origin answered and when it last sent bytes;
// one test's answers must not change how the next reads a failed fetch or
// waits.
afterEach(() => {
  clearHostResponses()
  clearFetchActivity()
})

// Longer waitFor/findBy timeouts for coverage runs (vitest.config.ts).
const asyncTimeoutMs = Number(process.env.TESTING_LIBRARY_ASYNC_TIMEOUT_MS)
if (Number.isFinite(asyncTimeoutMs) && asyncTimeoutMs > 0) {
  configure({ asyncUtilTimeout: asyncTimeoutMs })
}

// jsdom reports the host's CPU count, and detectPerformanceBudget() picks the compact
// profile at <= 4 cores (e.g. GitHub's 4-vCPU runners). Pin it so the default budget
// does not depend on the machine running the tests.
if (typeof window !== 'undefined') {
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  })
}
