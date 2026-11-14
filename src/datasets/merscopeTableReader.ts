// Reads a MERSCOPE region's two cell tables and joins them. Each CSV is
// fetched whole, gunzipped when its bytes are gzip (GEO gzips every file),
// and parsed into columns; see merscopeFormat.ts.

import { readMaybeGzipText } from '../data/readMaybeGzipText'
import {
  MERSCOPE_CSV_MAX_BYTES,
  merscopeTable,
  parseMerscopeCellByGene,
  parseMerscopeCellMetadata,
  type MerscopeTable,
} from './merscopeFormat'

export interface MerscopeTableFiles {
  readonly cellByGene: string
  readonly cellMetadata: string
}

export interface ReadMerscopeTableOptions {
  readonly files: MerscopeTableFiles
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly onProgress?: (message: string) => void
}

export type MerscopeTableReader = (
  options: ReadMerscopeTableOptions,
) => Promise<MerscopeTable>

export class MerscopeCsvTooLargeError extends Error {
  readonly url: string
  readonly byteLength: number

  constructor(url: string, byteLength: number) {
    super(
      `${fileName(url)} is ${formatMegabytes(byteLength)}, above the ${formatMegabytes(
        MERSCOPE_CSV_MAX_BYTES,
      )} browser load limit.`,
    )
    this.name = 'MerscopeCsvTooLargeError'
    this.url = url
    this.byteLength = byteLength
  }
}

export const readMerscopeTable: MerscopeTableReader = async (options) => {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const { files, onProgress, signal } = options
  const [countsText, metadataText] = await Promise.all([
    readCsvText(files.cellByGene, fetcher, signal, onProgress),
    readCsvText(files.cellMetadata, fetcher, signal, onProgress),
  ])
  const counts = parseMerscopeCellByGene(countsText, fileName(files.cellByGene))
  const metadata = parseMerscopeCellMetadata(metadataText, fileName(files.cellMetadata))
  onProgress?.(
    `MERSCOPE tables parsed: ${counts.ids.length.toLocaleString()} cells × ${counts.genes.length.toLocaleString()} genes${
      counts.blankColumnCount > 0
        ? ` (+${counts.blankColumnCount.toLocaleString()} Blank)`
        : ''
    }; ${metadata.columns.length.toLocaleString()} metadata columns`,
  )

  return merscopeTable(counts, metadata)
}

async function readCsvText(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
  onProgress: ((message: string) => void) | undefined,
): Promise<string> {
  const response = await fetcher(url, signal === undefined ? {} : { signal })

  if (!response.ok) {
    throw new Error(`${fileName(url)} returned HTTP ${response.status}.`)
  }

  const declared = Number(response.headers.get('Content-Length'))

  if (Number.isFinite(declared) && declared > MERSCOPE_CSV_MAX_BYTES) {
    await response.body?.cancel()
    throw new MerscopeCsvTooLargeError(url, declared)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength > MERSCOPE_CSV_MAX_BYTES) {
    throw new MerscopeCsvTooLargeError(url, bytes.byteLength)
  }

  const text = await readMaybeGzipText(new Response(bytes))

  // A gzipped file is checked again once inflated. Characters stand in for
  // bytes: the files are ASCII.
  if (text.length > MERSCOPE_CSV_MAX_BYTES) {
    throw new MerscopeCsvTooLargeError(url, text.length)
  }

  onProgress?.(
    `MERSCOPE ${fileName(url)} loaded (${formatMegabytes(bytes.byteLength)}${
      text.length > bytes.byteLength ? `, ${formatMegabytes(text.length)} unzipped` : ''
    })`,
  )
  return text
}

// The file name for messages: the last path segment, or the one before a
// Zenodo `/content` suffix.
export function fileName(url: string): string {
  let path = url

  try {
    path = decodeURIComponent(new URL(url).pathname)
  } catch {
    // Not an absolute URL: use it as given.
  }

  const segments = path.split('/').filter((segment) => segment.length > 0)
  const last = segments.at(-1) ?? url

  return last === 'content' && segments.length > 1 ? (segments.at(-2) ?? last) : last
}

export function formatMegabytes(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
