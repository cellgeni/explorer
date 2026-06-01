import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
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
