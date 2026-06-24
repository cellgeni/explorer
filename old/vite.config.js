import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
    include: ["@cornerstonejs/codec-openjpeg"],
  },
  assetsInclude: ["**/*.wasm"],
  define: {
    global: 'globalThis',
  },
});
