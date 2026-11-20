// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import viteConfig, {
  buildCommitMeta,
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
      expect.arrayContaining(['@cornerstonejs/codec-openjpeg/decodewasmjs']),
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

  it('keeps h5wasm out of the vendor chunks, so it loads only when imported', () => {
    const groupOf = (path: string) =>
      dependencyChunkGroups.find((group) => group.test.test(path))?.name

    expect(groupOf('/app/node_modules/h5wasm/dist/esm/hdf5_hl.js')).toBeUndefined()
    expect(
      groupOf('C:\\app\\node_modules\\h5wasm\\dist\\esm\\hdf5_hl.js'),
    ).toBeUndefined()
    expect(groupOf('/app/node_modules/zarrita/dist/src/index.js')).toBe(
      'spatial-io-vendor',
    )
    expect(groupOf('/app/node_modules/hyparquet/src/index.js')).toBe('spatial-io-vendor')
  })
})

describe('buildCommitMeta', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'
  const tags = (plugin: ReturnType<typeof buildCommitMeta>) =>
    (plugin.transformIndexHtml as () => unknown)()

  it("records a build's commit, and a release build's tag", () => {
    expect(tags(buildCommitMeta(sha, 'v0.1.0'))).toEqual([
      { tag: 'meta', attrs: { name: 'build-commit', content: sha }, injectTo: 'head' },
      {
        tag: 'meta',
        attrs: { name: 'build-release', content: 'v0.1.0' },
        injectTo: 'head',
      },
    ])
    expect(tags(buildCommitMeta(sha, undefined))).toEqual([
      { tag: 'meta', attrs: { name: 'build-commit', content: sha }, injectTo: 'head' },
    ])
    expect(tags(buildCommitMeta(undefined, 'v0.1.0'))).toEqual([])
  })
})
