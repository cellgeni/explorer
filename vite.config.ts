import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  {
    name: 'spatial-io-vendor',
    test: /node_modules[\\/](@zarrita|zarrita|geotiff|hyparquet|hyparquet-compressors|h5wasm)[\\/]/,
    priority: 30,
  },
  {
    name: 'codec-vendor',
    test: /node_modules[\\/](@cornerstonejs|pako|lerc|zstddec)[\\/]/,
    priority: 30,
  },
]

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
    include: ['@cornerstonejs/codec-openjpeg'],
  },
  plugins: [react()],
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
})
