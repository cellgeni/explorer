import { describe, expect, it } from 'vitest'
import { detectPerformanceBudget } from './performanceBudget'

describe('detectPerformanceBudget', () => {
  it('uses compact limits for low-memory or low-core devices', () => {
    expect(
      detectPerformanceBudget({ hardwareConcurrency: 4, deviceMemory: 8 }).profile,
    ).toBe('compact')
    expect(
      detectPerformanceBudget({ hardwareConcurrency: 8, deviceMemory: 4 }).profile,
    ).toBe('compact')
  })

  it('uses expanded limits for high-memory multi-core devices', () => {
    const budget = detectPerformanceBudget({ hardwareConcurrency: 10, deviceMemory: 16 })

    expect(budget.profile).toBe('expanded')
    expect(budget.maxConcurrentTileRequests).toBeGreaterThan(4)
  })
})
