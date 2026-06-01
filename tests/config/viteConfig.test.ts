// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import viteConfig, { crossOriginIsolationHeaders } from '../../vite.config'

function assertStaticUserConfig(config: typeof viteConfig): UserConfig {
  if (typeof config === 'function') {
    throw new Error('Expected Vite config to be a static object.')
  }

  if (config instanceof Promise) {
    throw new Error('Expected Vite config to be synchronous.')
  }

  return config
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
})
