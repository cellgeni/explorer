import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

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
