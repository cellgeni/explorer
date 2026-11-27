import { parquetMetadataAsync, parquetRead, parquetSchema } from 'hyparquet'
import type { AsyncBuffer, Compressors, FileMetaData } from 'hyparquet'

// Reads Parquet columns as hyparquet decodes them, without building an
// object per row: on hundreds of thousands of rows those objects cost more
// than the decode.

export interface ReadParquetColumnsOptions {
  readonly file: AsyncBuffer
  // The parsed footer, when the caller has it.
  readonly metadata?: FileMetaData
  readonly columns: readonly string[]
  readonly rowStart?: number
  readonly rowEnd?: number
  readonly compressors?: Compressors
}

// Each requested column the file has, with one value per row from
// `rowStart` (0) to `rowEnd` (the end); columns the file lacks are left out.
export async function readParquetColumns(
  options: ReadParquetColumnsOptions,
): Promise<Readonly<Record<string, ArrayLike<unknown>>>> {
  const metadata = options.metadata ?? (await parquetMetadataAsync(options.file))
  const fileColumns = new Set(
    parquetSchema(metadata).children.map((child) => child.element.name),
  )
  const columns = options.columns.filter((column) => fileColumns.has(column))
  // Counted from the row groups, which hyparquet reads: some writers put a
  // wrong total in the footer (fastparquet 1.0.0, in a Xenium XOA 1.0.1 run).
  const fileRows = metadata.row_groups.reduce(
    (sum, group) => sum + Number(group.num_rows),
    0,
  )
  const rowStart = options.rowStart ?? 0
  const rowCount = Math.max(0, Math.min(fileRows, options.rowEnd ?? Infinity) - rowStart)
  const chunks = new Map<string, ColumnChunk[]>(columns.map((column) => [column, []]))

  await parquetRead({
    file: options.file,
    metadata,
    columns: [...columns],
    ...(options.compressors === undefined ? {} : { compressors: options.compressors }),
    ...(options.rowStart === undefined ? {} : { rowStart: options.rowStart }),
    ...(options.rowEnd === undefined ? {} : { rowEnd: options.rowEnd }),
    onChunk: ({ columnName, columnData, rowStart: chunkStart }) => {
      chunks
        .get(columnName)
        ?.push({ rowStart: chunkStart - rowStart, values: columnData })
    },
  })

  return Object.fromEntries(
    columns.map((column) => [
      column,
      joinColumnChunks(chunks.get(column) ?? [], rowCount),
    ]),
  )
}

interface ColumnChunk {
  // From the first row asked for; negative for a page that starts before it.
  readonly rowStart: number
  readonly values: ArrayLike<unknown>
}

// Chunks arrive in any order and hold whole pages, so rows outside the range
// are dropped.
function joinColumnChunks(
  chunks: readonly ColumnChunk[],
  rowCount: number,
): ArrayLike<unknown> {
  const [first] = chunks

  if (
    chunks.length === 1 &&
    first !== undefined &&
    first.rowStart === 0 &&
    first.values.length === rowCount
  ) {
    return first.values
  }

  const values = new Array<unknown>(rowCount)

  for (const { rowStart, values: chunkValues } of chunks) {
    const start = Math.max(0, -rowStart)
    const end = Math.min(chunkValues.length, rowCount - rowStart)

    for (let index = start; index < end; index += 1) {
      values[rowStart + index] = chunkValues[index]
    }
  }

  return values
}
