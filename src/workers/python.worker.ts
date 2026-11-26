/// <reference lib="webworker" />
import type { PyodideAPI } from 'pyodide'
import { createPythonCore } from './pythonCore'
import type { PythonWorkerRequest, PythonWorkerResponse } from './pythonMessages'
import runtimeSource from '../python/runtime/explorer_runtime.py?raw'

// Pyodide is loaded from the build's own `pyodide/` folder (plan 29-D1), not
// bundled: its loader imports its other files from beside itself.

const explorerSources = import.meta.glob<string>('../python/explorer/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const sources: Record<string, string> = { 'explorer_runtime.py': runtimeSource }
for (const [path, source] of Object.entries(explorerSources)) {
  sources[path.slice(path.indexOf('explorer/'))] = source
}

const scope = self as DedicatedWorkerGlobalScope

const core = createPythonCore({
  post: (message: PythonWorkerResponse, transfer: Transferable[] = []) => {
    scope.postMessage(message, transfer)
  },
  loadPyodide: async (options) => {
    const module = (await import(
      /* @vite-ignore */ `${options.indexURL}pyodide.mjs`
    )) as {
      loadPyodide: (options: object) => Promise<PyodideAPI>
    }
    return module.loadPyodide(options)
  },
  sources,
})

scope.onmessage = (event: MessageEvent<PythonWorkerRequest>) => {
  core.handle(event.data)
}
