/// <reference types="vite/client" />

// Build-time settings read through import.meta.env.
interface ImportMetaEnv {
  // Where the start screen reads the example gallery (plan 15.3-A). Defaults
  // to examples/index.json on GitHub's main branch.
  readonly VITE_EXAMPLES_INDEX_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
