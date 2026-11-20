// Reads a MERSCOPE region's two cell tables and joins them. Each CSV is
// fetched whole, gunzipped when its bytes are gzip (GEO gzips every file),
// and parsed into columns; see merscopeFormat.ts.

import { inflateMaybeGzipBytes } from '../data/readMaybeGzipText'
import { urlFileName as fileName } from '../data/urlFileName'
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

  // `atLeast`: a gzipped file whose inflating stopped at `byteLength`.
  constructor(
    url: string,
    byteLength: number,
    options: { readonly atLeast?: boolean } = {},
  ) {
    super(
      options.atLeast === true
        ? `${fileName(url)} inflates to more than ${formatMegabytes(
            MERSCOPE_CSV_MAX_BYTES,
          )}, the browser load limit.`
        : `${fileName(url)} is ${formatMegabytes(byteLength)}, above the ${formatMegabytes(
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

  // A gzipped file is inflated within the same limit: refused from its
  // trailer's size, or stopped once past it, rather than inflated whole.
  const inflated = await inflateMaybeGzipBytes(
    bytes,
    MERSCOPE_CSV_MAX_BYTES,
    ({ byteLength, exact }) =>
      new MerscopeCsvTooLargeError(url, byteLength, { atLeast: !exact }),
  )

  onProgress?.(
    `MERSCOPE ${fileName(url)} loaded (${formatMegabytes(bytes.byteLength)}${
      inflated !== bytes ? `, ${formatMegabytes(inflated.byteLength)} unzipped` : ''
    })`,
  )
  return new TextDecoder().decode(inflated)
}

export { fileName }

export function formatMegabytes(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
