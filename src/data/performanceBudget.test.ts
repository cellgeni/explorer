import { describe, expect, it } from 'vitest'
import { detectPerformanceBudget } from './performanceBudget'

describe('detectPerformanceBudget', () => {
  it('uses compact limits for low-memory or low-core devices', () => {
    const lowCoreBudget = detectPerformanceBudget({
      hardwareConcurrency: 4,
      deviceMemory: 8,
    })
    const lowMemoryBudget = detectPerformanceBudget({
      hardwareConcurrency: 8,
      deviceMemory: 4,
    })

    expect(lowCoreBudget.profile).toBe('compact')
    expect(lowMemoryBudget.profile).toBe('compact')
    expect(lowCoreBudget.boundaryCellLimit).toBe(2_500)
  })

  it('uses a 50,000 boundary limit for balanced devices', () => {
    const budget = detectPerformanceBudget({})

    expect(budget.profile).toBe('balanced')
    expect(budget.boundaryCellLimit).toBe(50_000)
  })

  it('uses expanded limits for high-memory multi-core devices', () => {
    const budget = detectPerformanceBudget({ hardwareConcurrency: 10, deviceMemory: 16 })

    expect(budget.profile).toBe('expanded')
    expect(budget.boundaryCellLimit).toBe(50_000)
    expect(budget.maxConcurrentTileRequests).toBeGreaterThan(4)
  })
})
