import { act, render, renderHook, screen, within } from '@testing-library/react'
import type { FileMetaData } from 'hyparquet'
import { describe, expect, it, vi } from 'vitest'
import type { ParquetRowPreview } from '../../data/parquetRows'
import { parquetStructureFromMetadata } from '../../data/parquetStructure'
import { ParquetRowsPanel } from './ParquetRowsPanel'
import { useParquetRows, type ParquetRowsReader } from './useParquetRows'

// A file of float columns `gene_0`, `gene_1`, … in one row group of 100
// rows; only its footer, for the panel and the hook.
function wideStructure(columns: number) {
  const names = Array.from({ length: columns }, (_, index) => `gene_${index}`)
  const metadata = {
    version: 2,
    schema: [
      { name: 'schema', num_children: columns },
      ...names.map((name) => ({ name, type: 'FLOAT', repetition_type: 'OPTIONAL' })),
    ],
    num_rows: 100n,
    row_groups: [
      {
        columns: names.map((name) => ({
          file_offset: 0n,
          meta_data: {
            type: 'FLOAT',
            encodings: ['PLAIN'],
            path_in_schema: [name],
            codec: 'ZSTD',
            num_values: 100n,
            total_uncompressed_size: 500n,
            total_compressed_size: 400n,
            data_page_offset: 4n,
          },
        })),
        total_byte_size: 500n * BigInt(columns),
        total_compressed_size: 400n * BigInt(columns),
        num_rows: 100n,
      },
    ],
    metadata_length: 1_000,
  } as unknown as FileMetaData
  return parquetStructureFromMetadata(metadata, {
    ref: { url: 'https://host.test/wide.parquet' },
    byteLength: 2_000_000,
  })
}

function preview(names: readonly string[], value: unknown = 1): ParquetRowPreview {
  return {
    columns: names.map((name) => ({
      name,
      values: Array.from({ length: 20 }, () => value),
    })),
    rowCount: 20,
    rowGroup: 0,
    bytesRead: 100,
  }
}

describe('ParquetRowsPanel', () => {
  // 3,000 columns drew 60,000 cells, each column a request (EXP-266).
  it('shows the columns read so far and offers the next ones', () => {
    const structure = wideStructure(3_000)
    const names = structure.root.children.slice(0, 40).map((child) => child.name)

    render(
      <ParquetRowsPanel
        structure={structure}
        state={{ status: 'ready', preview: preview(names), more: { status: 'idle' } }}
        onRead={vi.fn()}
        onReadMore={vi.fn()}
      />,
    )

    expect(screen.getByText(/Columns 1 to 40 of 3,000\./)).toBeInTheDocument()
    expect(
      screen.getByTitle('Read the next 40 columns of the first rows'),
    ).toHaveTextContent('Read 40 More Columns')
    const table = screen.getByRole('table', { name: 'First rows' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(41)
  })

  // A value cut at 60 characters could be read nowhere (EXP-266).
  it('shows a long value whole in its tooltip', () => {
    const structure = wideStructure(1)
    const long = 'x'.repeat(200)

    render(
      <ParquetRowsPanel
        structure={structure}
        state={{
          status: 'ready',
          preview: preview(['gene_0'], long),
          more: { status: 'idle' },
        }}
        onRead={vi.fn()}
        onReadMore={vi.fn()}
      />,
    )

    const cell = screen.getAllByRole('cell')[0]!
    expect(cell.textContent).toBe(`${'x'.repeat(60)}…`)
    expect(cell).toHaveAttribute('title', long)
  })
})

describe('useParquetRows', () => {
  it('reads the first page of columns, then the next on request', async () => {
    const structure = wideStructure(90)
    const reader = vi.fn<ParquetRowsReader>(async (_structure, _signal, columns) =>
      preview(columns ?? structure.root.children.slice(0, 40).map((child) => child.name)),
    )
    const { result } = renderHook(() => useParquetRows(structure, reader))

    await act(async () => {
      result.current.read()
    })
    expect(reader).toHaveBeenLastCalledWith(structure, expect.any(AbortSignal), undefined)
    await act(async () => {
      result.current.readMore()
    })
    expect(reader.mock.lastCall?.[2]).toEqual(
      Array.from({ length: 40 }, (_, index) => `gene_${40 + index}`),
    )
    await act(async () => {
      result.current.readMore()
    })
    expect(reader.mock.lastCall?.[2]).toHaveLength(10)

    const state = result.current.state
    expect(state.status === 'ready' && state.preview.columns.length).toBe(90)
    expect(state.status === 'ready' && state.preview.bytesRead).toBe(300)
  })

  // Closing the drawer during a read left it running (EXP-266).
  it('stops a read when the file is no longer shown, and offers it again', async () => {
    const structure = wideStructure(1)
    let signal: AbortSignal | undefined
    const reader = vi.fn<ParquetRowsReader>(
      (_structure, readSignal) =>
        new Promise((_resolve, reject) => {
          signal = readSignal
          readSignal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const { result, rerender } = renderHook(
      ({ active }) => useParquetRows(structure, reader, active),
      { initialProps: { active: true } },
    )

    act(() => {
      result.current.read()
    })
    expect(result.current.state.status).toBe('loading')

    await act(async () => {
      rerender({ active: false })
    })
    expect(signal?.aborted).toBe(true)
    expect(result.current.state.status).toBe('idle')
  })
})
