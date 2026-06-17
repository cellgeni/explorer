/// <reference lib="webworker" />

import {
  gexFromVisiumFeatureSliceH5File,
  type H5FileLike,
} from '../data/visiumFeatureSlice'
import type {
  VisiumFeatureSliceWorkerRequest,
  VisiumFeatureSliceWorkerResponse,
} from './visiumFeatureSliceMessages'

interface LazyFileFs {
  createLazyFile(
    parent: string,
    name: string,
    url: string,
    canRead: boolean,
    canWrite: boolean,
  ): unknown
  unlink(path: string): void
}

type ClosableH5FileLike = H5FileLike & { close?: () => void }

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<VisiumFeatureSliceWorkerRequest>) => {
  void readFeatureSlice(event.data)
}

async function readFeatureSlice(request: VisiumFeatureSliceWorkerRequest): Promise<void> {
  try {
    const h5wasm = (await import('h5wasm')).default
    const { FS } = await h5wasm.ready
    const lazyFs = FS as LazyFileFs
    const fileName = `visium-feature-slice-${request.id}-${hashString(request.url)}.h5`
    const filePath = `/${fileName}`

    try {
      lazyFs.unlink(filePath)
    } catch {
      // The lazy file only exists when a previous worker request reused this name.
    }

    lazyFs.createLazyFile('/', fileName, request.url, true, false)

    let file: ClosableH5FileLike | null = null

    try {
      file = new h5wasm.File(filePath, 'r') as ClosableH5FileLike
      const result = gexFromVisiumFeatureSliceH5File(
        file,
        request.targets,
        request.genes,
        { binSizeMicrometers: request.binSizeMicrometers },
      )
      const response: VisiumFeatureSliceWorkerResponse = {
        id: request.id,
        ok: true,
        geneNames: result.geneNames,
        cells: Array.from(result.cells, ([id, cell]) => ({
          id,
          geneNames: [...cell.geneNames],
          counts: [...cell.counts],
        })),
      }

      workerScope.postMessage(response)
    } finally {
      try {
        file?.close?.()
      } catch {
        // Best-effort cleanup; result or original error is more useful.
      }

      try {
        lazyFs.unlink(filePath)
      } catch {
        // Best-effort cleanup for the Emscripten lazy file handle.
      }
    }
  } catch (cause) {
    const response: VisiumFeatureSliceWorkerResponse = {
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof Error && cause.name.length > 0
        ? { errorName: cause.name }
        : {}),
    }

    workerScope.postMessage(response)
  }
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(16)
}
