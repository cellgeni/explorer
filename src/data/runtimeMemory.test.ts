import { describe, expect, it } from 'vitest'
import { formatRuntimeMemorySnapshot, readRuntimeMemorySnapshot } from './runtimeMemory'

describe('runtime memory profiling', () => {
  it('reads browser heap and device-memory signals when available', () => {
    expect(
      readRuntimeMemorySnapshot({
        performance: {
          memory: {
            usedJSHeapSize: 1024 * 1024,
            totalJSHeapSize: 2 * 1024 * 1024,
            jsHeapSizeLimit: 4 * 1024 * 1024,
          },
        },
        navigator: {
          deviceMemory: 8,
        },
      }),
    ).toEqual({
      usedJSHeapSize: 1024 * 1024,
      totalJSHeapSize: 2 * 1024 * 1024,
      jsHeapSizeLimit: 4 * 1024 * 1024,
      deviceMemoryGb: 8,
    })
  })

  it('formats a compact debug-log detail', () => {
    expect(
      formatRuntimeMemorySnapshot({
        usedJSHeapSize: 1024 * 1024,
        totalJSHeapSize: 2 * 1024 * 1024,
        jsHeapSizeLimit: 4 * 1024 * 1024,
        deviceMemoryGb: 8,
      }),
    ).toBe('used 1.0 MB, total 2.0 MB, limit 4.0 MB, device 8 GB')
  })

  it('omits unsupported or invalid runtime memory signals', () => {
    expect(
      readRuntimeMemorySnapshot({
        performance: {
          memory: {
            usedJSHeapSize: Number.NaN,
            totalJSHeapSize: -1,
          },
        },
        navigator: {
          deviceMemory: 0,
        },
      }),
    ).toBeNull()
    expect(formatRuntimeMemorySnapshot(null)).toBeUndefined()
  })
})
