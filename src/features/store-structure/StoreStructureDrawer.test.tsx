import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../../test/annDataZarrFixtures'
import {
  readParquetStructure,
  type ParquetFileRef,
  type ParquetStructure,
  type ReadParquetStructureOptions,
} from '../../data/parquetStructure'
import { spatialDataShapesFixtureBytes } from '../../test/spatialDataShapesFixtures'
import { rangeFetcher, xeniumCellsFixtureBytes } from '../../test/xeniumCellsFixtures'
import {
  structureFromFlatNodes,
  type ReadZarrStructureOptions,
  type ZarrStructure,
} from '../../zarr/zarrStructure'
import { StoreStructureDrawer } from './StoreStructureDrawer'
import { useStoreStructure } from './useStoreStructure'

const STORE_URL = `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`
const fixtureFetcher = annDataZarrFixtureFetcher()

type Reader = (url: string, options: ReadZarrStructureOptions) => Promise<ZarrStructure>
type ParquetReader = (
  file: ParquetFileRef,
  options: ReadParquetStructureOptions,
) => Promise<ParquetStructure>

function Harness({
  url = STORE_URL,
  read,
  readParquet,
}: {
  readonly url?: string
  readonly read?: Reader
  readonly readParquet?: ParquetReader
}) {
  const store = useStoreStructure({
    fetcher: fixtureFetcher,
    ...(read === undefined ? {} : { read }),
    ...(readParquet === undefined ? {} : { readParquet }),
  })

  return (
    <>
      <button
        type="button"
        title="Browse"
        onClick={() => {
          store.browse(url)
        }}
      >
        Browse
      </button>
      <StoreStructureDrawer store={store} />
    </>
  )
}

function drawer() {
  return screen.getByRole('dialog', { name: 'Store structure' })
}

describe('StoreStructureDrawer', () => {
  it('reads the store and shows its tree, summary and node details', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    expect(drawer()).toBeVisible()
    expect(await within(drawer()).findByText('Consolidated metadata')).toBeInTheDocument()
    expect(within(drawer()).getByText('Zarr v2')).toBeInTheDocument()
    expect(within(drawer()).getByText('AnnData 0.1.0')).toBeInTheDocument()
    expect(within(drawer()).getByText('13 groups · 14 arrays')).toBeInTheDocument()

    // A small store opens the root's child groups.
    fireEvent.click(screen.getByRole('button', { name: 'Expand cluster' }))
    fireEvent.click(screen.getByTitle('Show details of obs/cluster/codes'))

    const details = screen.getByRole('region', { name: 'codes' })
    expect(within(details).getByText('/obs/cluster/codes')).toBeInTheDocument()
    expect(within(details).getByText('Array (Zarr v2)')).toBeInTheDocument()
    expect(within(details).getByText('int8')).toBeInTheDocument()
    expect(
      within(details).getByText(`${STORE_URL}/obs/cluster/codes`),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse obs' }))
    expect(screen.queryByTitle('Show details of obs/cluster')).not.toBeInTheDocument()
  })

  it('filters the tree by path', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await within(drawer()).findByText('Consolidated metadata')

    fireEvent.change(screen.getByPlaceholderText('Filter by name or path'), {
      target: { value: 'X_' },
    })

    expect(screen.getByText('2 matches.')).toBeInTheDocument()
    expect(screen.getByTitle('Show details of obsm/X_umap')).toBeInTheDocument()
    expect(screen.getByTitle('Show details of obsm/X_scvi')).toBeInTheDocument()
    expect(screen.queryByTitle('Show details of obs')).not.toBeInTheDocument()

    // A group the filter opened closes on request.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse obsm' }))
    expect(screen.queryByTitle('Show details of obsm/X_umap')).not.toBeInTheDocument()

    // A matching group keeps its contents, closed.
    fireEvent.change(screen.getByPlaceholderText('Filter by name or path'), {
      target: { value: 'cluster' },
    })
    expect(
      screen.queryByTitle('Show details of obs/cluster/codes'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand cluster' }))
    expect(screen.getByTitle('Show details of obs/cluster/codes')).toBeInTheDocument()
  })

  it('reports a failed read and retries it', async () => {
    const read = vi.fn<Reader>(async () => {
      throw new TypeError('Failed to fetch')
    })
    render(<Harness read={read} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    const alert = await within(drawer()).findByRole('alert')
    expect(within(alert).getByText('Network request failed')).toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps what it read while closed, and stops a read when closed', async () => {
    let finish: (() => void) | undefined
    const signals: AbortSignal[] = []
    const read = vi.fn<Reader>(async (url, options) => {
      if (options.signal !== undefined) signals.push(options.signal)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return (await import('../../zarr/zarrStructure')).readZarrStructure(url, {
        fetcher: fixtureFetcher,
      })
    })
    render(<Harness read={read} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    expect(within(drawer()).getByRole('status')).toHaveTextContent('Reading the store…')
    fireEvent.click(screen.getByRole('button', { name: 'Close Store structure' }))
    expect(signals[0]?.aborted).toBe(true)

    // Reopened, it reads again, and keeps the result once it has one.
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => {
      finish?.()
    })
    await within(drawer()).findByText('Consolidated metadata')

    fireEvent.click(screen.getByRole('button', { name: 'Close Store structure' }))
    expect(screen.queryByRole('dialog', { name: 'Store structure' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    expect(within(drawer()).getByText('Consolidated metadata')).toBeInTheDocument()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('browses a Parquet file by address: schema, row groups and column details', async () => {
    const bytes = xeniumCellsFixtureBytes('cells.parquet')
    const readParquet = vi.fn<ParquetReader>((file, options) =>
      readParquetStructure(file, { ...options, fetcher: rangeFetcher(bytes) }),
    )
    render(
      <Harness url="https://bucket.test/run/cells.parquet" readParquet={readParquet} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    const dialog = screen.getByRole('dialog', { name: 'Parquet file' })
    expect(
      await within(dialog).findByText('10 rows · 8 columns · 3 row groups'),
    ).toBeInTheDocument()
    expect(readParquet).toHaveBeenCalledWith(
      { url: 'https://bucket.test/run/cells.parquet' },
      expect.anything(),
    )
    expect(within(dialog).getByText('Parquet, format version 2')).toBeInTheDocument()
    expect(within(dialog).getByText('Arrow schema')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Back to Store' })).toBeNull()

    // The file's details list its row groups.
    const file = screen.getByRole('region', { name: 'cells.parquet' })
    const rowGroups = within(file).getByRole('table', { name: 'Row groups' })
    expect(within(rowGroups).getAllByRole('row')).toHaveLength(4)

    fireEvent.click(screen.getByTitle('Show details of cell_area'))
    const details = screen.getByRole('region', { name: 'cell_area' })
    const fact = (label: string) =>
      within(details).getByText(label).nextElementSibling?.textContent
    expect(fact('Type')).toBe('double')
    expect(fact('Stored as')).toBe('DOUBLE')
    expect(fact('Repetition')).toBe('optional')
    expect(fact('Compression')).toBe('ZSTD')
    expect(fact('Nulls')).toBe('1')
    expect(fact('Minimum')).toBe('30')
    expect(fact('Maximum')).toBe('39')
  })

  it('opens a Parquet file from the store, and goes back to the tree as it was', async () => {
    const storeUrl = 'https://bucket.test/sample.zarr'
    const read = vi.fn<Reader>(async () =>
      structureFromFlatNodes({
        url: storeUrl,
        source: 'walked',
        zarrFormat: 2,
        listing: 'S3 listing',
        truncated: false,
        flat: [
          { path: '', kind: 'group' },
          { path: 'shapes', kind: 'group' },
          {
            path: 'shapes/cells',
            kind: 'group',
            attributes: { 'encoding-type': 'ngff:shapes' },
          },
          { path: 'shapes/cells/shapes.parquet', kind: 'file', storedBytes: 1_492 },
        ],
      }),
    )
    const readParquet = vi.fn<ParquetReader>((file, options) =>
      readParquetStructure(file, {
        ...options,
        fetcher: rangeFetcher(spatialDataShapesFixtureBytes('cell_boundaries.parquet')),
      }),
    )
    render(<Harness url={storeUrl} read={read} readParquet={readParquet} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await within(drawer()).findByText('Contents')

    fireEvent.click(screen.getByRole('button', { name: 'Expand cells' }))
    fireEvent.click(screen.getByTitle('Show details of shapes/cells/shapes.parquet'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse File' }))

    const dialog = screen.getByRole('dialog', { name: 'Parquet file' })
    expect(
      await within(dialog).findByText('GeoParquet 1.1.0, pandas, Arrow schema'),
    ).toBeInTheDocument()
    expect(readParquet).toHaveBeenCalledWith(
      { url: `${storeUrl}/shapes/cells/shapes.parquet` },
      expect.anything(),
    )
    expect(within(dialog).getByText('WKB geometry')).toBeInTheDocument()
    expect(within(dialog).getByText('pandas index')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to Store' }))
    expect(drawer()).toBeVisible()
    expect(
      screen.getByTitle('Show details of shapes/cells/shapes.parquet'),
    ).toHaveAttribute('aria-current', 'true')
    expect(read).toHaveBeenCalledTimes(1)
  })
})
