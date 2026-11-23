import { abortError } from '../utils/abort'
import {
  H5_RANGE_UNSUPPORTED_ERROR,
  type H5FileRangeStats,
} from '../workers/h5FileMessages'
import type { H5StructureWalk, H5ValuePreview } from './h5StructureTypes'
import { openH5WorkerFileFromUrl, type H5WorkerFile } from './h5WorkerFile'

// Browse File for an HDF5 file (H5, H5AD, Loom): its groups, datasets and
// attributes, walked in an H5 file worker that reads the file by range, and
// the first values of a dataset on request. The worker stays open for those
// until `close`.

export interface H5Structure extends H5StructureWalk {
  readonly url: string
  // The file's size and the range reads the walk took.
  readonly range: H5FileRangeStats | null
  readValues(path: string, signal: AbortSignal): Promise<H5ValuePreview>
  close(): void
}

export interface ReadH5StructureOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (count: number) => void
  readonly maxNodes?: number
  // Opens the file; tests pass bytes instead of a URL.
  readonly open?: (url: string, signal: AbortSignal | undefined) => Promise<H5WorkerFile>
}

export class H5FileNotFoundError extends Error {
  readonly url: string

  constructor(url: string, status: number) {
    super(`${url} could not be read (HTTP ${status}).`)
    this.name = 'H5FileNotFoundError'
    this.url = url
  }
}

export class NotH5FileError extends Error {
  readonly url: string

  constructor(url: string) {
    super(`${url} is not an HDF5 file h5wasm can open.`)
    this.name = 'NotH5FileError'
    this.url = url
  }
}

export class H5RangeRequiredError extends Error {
  readonly url: string

  constructor(url: string, detail: string) {
    super(`${detail} Browsing would mean downloading all of ${url}.`)
    this.name = 'H5RangeRequiredError'
    this.url = url
  }
}

// HDF5 files by name: plain HDF5, AnnData, Loom, HDF-EOS5.
export function isH5FileName(name: string): boolean {
  return /\.(?:h5|hdf5|h5ad|loom|he5)$/i.test(name)
}

export function h5FileName(url: string): string {
  try {
    const { pathname } = new URL(url)
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || url
  } catch {
    return url
  }
}

export async function readH5Structure(
  url: string,
  options: ReadH5StructureOptions = {},
): Promise<H5Structure> {
  const { signal } = options
  const name = h5FileName(url)
  // A server that ignores Range would send the whole file, which may be many
  // gigabytes, so the open fails instead.
  const open =
    options.open ??
    ((address: string, openSignal: AbortSignal | undefined) =>
      openH5WorkerFileFromUrl(address, name, {
        rangeOnly: true,
        ...(openSignal === undefined ? {} : { signal: openSignal }),
      }))
  let file: H5WorkerFile

  try {
    file = await open(url, signal)
  } catch (error) {
    throw openError(url, error)
  }

  // The walk runs to its end in the worker; closing the worker stops it.
  const stop = () => {
    file.close()
  }
  signal?.addEventListener('abort', stop, { once: true })

  try {
    const walk = await file.structure({
      rootName: name,
      ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(signal === undefined ? {} : { signal }),
    })
    const range = await file.rangeStats()

    if (signal?.aborted === true) {
      throw abortError(signal)
    }

    return {
      ...walk,
      url,
      range,
      readValues: (path, readSignal) => file.preview(path, readSignal),
      close: () => {
        file.close()
      },
    }
  } catch (error) {
    file.close()
    throw error
  } finally {
    signal?.removeEventListener('abort', stop)
  }
}

function openError(url: string, error: unknown): unknown {
  if (!(error instanceof Error) || error.name === 'AbortError') {
    return error
  }

  if (error.name === H5_RANGE_UNSUPPORTED_ERROR) {
    return new H5RangeRequiredError(url, error.message)
  }

  const status = /returned HTTP (\d+)/.exec(error.message)?.[1]

  if (status !== undefined) {
    return new H5FileNotFoundError(url, Number(status))
  }

  if (/not a readable HDF5 file/.test(error.message)) {
    return new NotH5FileError(url)
  }

  return error
}
