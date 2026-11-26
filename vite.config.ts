import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { pyodideRuntime } from './scripts/pyodideRuntime.ts'

export const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const

export const dependencyChunkGroups = [
  {
    name: 'react-vendor',
    test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
    priority: 40,
  },
  {
    name: 'deck-vendor',
    test: /node_modules[\\/](@deck\.gl|deck\.gl|@luma\.gl|luma\.gl|@math\.gl|math\.gl)[\\/]/,
    priority: 35,
  },
  {
    name: 'duckdb-vendor',
    test: /node_modules[\\/]@duckdb[\\/]duckdb-wasm[\\/]/,
    priority: 35,
  },
  // h5wasm is left out: it inlines its WASM (3.7 MB of source), and the main
  // thread imports it only lazily. In this group, which the entry imports,
  // the start screen would preload it; on its own it loads when imported.
  {
    name: 'spatial-io-vendor',
    test: /node_modules[\\/](@zarrita|zarrita|geotiff|hyparquet|hyparquet-compressors)[\\/]/,
    priority: 30,
  },
  {
    name: 'codec-vendor',
    test: /node_modules[\\/](@cornerstonejs|pako|lerc|zstddec)[\\/]/,
    priority: 30,
  },
]

// Records the deployed commit, and a release build's tag, in index.html, so
// `curl` on the site shows them without running the app. The Pages and
// Release workflows set VITE_COMMIT_SHA; Release sets VITE_RELEASE_TAG.
export function buildCommitMeta(
  sha = process.env.VITE_COMMIT_SHA,
  tag = process.env.VITE_RELEASE_TAG,
): Plugin {
  return {
    name: 'build-commit-meta',
    transformIndexHtml() {
      if (sha === undefined || !/^[0-9a-f]{40}$/i.test(sha)) return []
      return [
        { tag: 'meta', attrs: { name: 'build-commit', content: sha }, injectTo: 'head' },
        ...(tag === undefined || !RELEASE_TAG.test(tag)
          ? []
          : [
              {
                tag: 'meta',
                attrs: { name: 'build-release', content: tag },
                injectTo: 'head' as const,
              },
            ]),
      ]
    },
  }
}

// A release tag as Git allows it here: v0.1.0, 2026.11, …
const RELEASE_TAG = /^[\w.+-]{1,64}$/

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: dependencyChunkGroups,
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', 'h5wasm'],
    // The decode-only OpenJPEG glue is CommonJS; its .wasm is a separate asset.
    include: ['@cornerstonejs/codec-openjpeg/decodewasmjs'],
  },
  plugins: [react(), buildCommitMeta(), pyodideRuntime()],
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
})
