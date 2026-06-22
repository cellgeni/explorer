// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import viteConfig, {
  crossOriginIsolationHeaders,
  dependencyChunkGroups,
} from '../../vite.config'

function assertStaticUserConfig(config: unknown): UserConfig {
  if (typeof config === 'function') {
    throw new Error('Expected Vite config to be a static object.')
  }

  if (config instanceof Promise) {
    throw new Error('Expected Vite config to be synchronous.')
  }

  return config as UserConfig
}

describe('vite config', () => {
  it('configures WASM package optimization boundaries', () => {
    const config = assertStaticUserConfig(viteConfig)

    expect(config.assetsInclude).toEqual(['**/*.wasm'])
    expect(config.optimizeDeps?.exclude).toEqual(
      expect.arrayContaining(['@duckdb/duckdb-wasm', 'h5wasm']),
    )
    expect(config.optimizeDeps?.include).toEqual(
      expect.arrayContaining(['@cornerstonejs/codec-openjpeg']),
    )
  })

  it('serves cross-origin isolation headers in development and preview', () => {
    const config = assertStaticUserConfig(viteConfig)

    expect(config.server?.headers).toEqual(crossOriginIsolationHeaders)
    expect(config.preview?.headers).toEqual(crossOriginIsolationHeaders)
  })

  it('splits heavy spatial dependencies into named production chunks', () => {
    const config = assertStaticUserConfig(viteConfig)
    const output = config.build?.rolldownOptions?.output
    const codeSplitting = Array.isArray(output)
      ? output[0]?.codeSplitting
      : output?.codeSplitting

    expect(codeSplitting).toMatchObject({
      groups: dependencyChunkGroups,
    })
    expect(dependencyChunkGroups.map((group) => group.name)).toEqual([
      'react-vendor',
      'deck-vendor',
      'duckdb-vendor',
      'spatial-io-vendor',
      'codec-vendor',
    ])
  })
})
