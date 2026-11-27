import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../../test/annDataZarrFixtures'
import {
  readH5Structure,
  type H5Structure,
  type ReadH5StructureOptions,
} from '../../data/h5Structure'
import { H5T_CLASS, type H5ValuePreview } from '../../data/h5StructureTypes'
import { openH5WorkerFile } from '../../data/h5WorkerFile'
import { createH5Bytes, writeBrowsableH5ad } from '../../test/h5Fixtures'
import {
  readParquetStructure,
  type ParquetFileRef,
  type ParquetStructure,
  type ReadParquetStructureOptions,
} from '../../data/parquetStructure'
import {
  readParquetRows as readRows,
  type ParquetRowPreview,
  type ReadParquetRowsOptions,
} from '../../data/parquetRows'
import { spatialDataShapesFixtureBytes } from '../../test/spatialDataShapesFixtures'
import { rangeFetcher, xeniumCellsFixtureBytes } from '../../test/xeniumCellsFixtures'
import {
  structureFromFlatNodes,
  type ReadZarrStructureOptions,
  type ZarrStructure,
} from '../../zarr/zarrStructure'
import type { ZarrValuePreview } from '../../zarr/zarrValuePreview'
import { H5FileView } from './H5StructureView'
import { StoreStructureDrawer, StoreStructureView } from './StoreStructureDrawer'
import { useStoreStructure, type ReadZarrValues } from './useStoreStructure'

const STORE_URL = `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`
const fixtureFetcher = annDataZarrFixtureFetcher()

type Reader = (url: string, options: ReadZarrStructureOptions) => Promise<ZarrStructure>
type RowsReader = (
  structure: ParquetStructure,
  options: ReadParquetRowsOptions,
) => Promise<ParquetRowPreview>
type ParquetReader = (
  file: ParquetFileRef,
  options: ReadParquetStructureOptions,
) => Promise<ParquetStructure>

type H5Reader = (url: string, options: ReadH5StructureOptions) => Promise<H5Structure>

function Harness({
  url = STORE_URL,
  read,
  readParquet,
  readParquetRows,
  readH5,
}: {
  readonly url?: string
  readonly read?: Reader
  readonly readParquet?: ParquetReader
  readonly readParquetRows?: RowsReader
  readonly readH5?: H5Reader
}) {
  const store = useStoreStructure({
    fetcher: fixtureFetcher,
    ...(read === undefined ? {} : { read }),
    ...(readParquet === undefined ? {} : { readParquet }),
    ...(readParquetRows === undefined ? {} : { readParquetRows }),
    ...(readH5 === undefined ? {} : { readH5 }),
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

function flatStore(flat: Parameters<typeof structureFromFlatNodes>[0]['flat']) {
  return structureFromFlatNodes({
    url: 'https://bucket.test/sample.zarr',
    source: 'consolidated',
    zarrFormat: 2,
    listing: null,
    truncated: false,
    flat,
  })
}

function renderStoreView(
  structure: ZarrStructure,
  readValues: ReadZarrValues = () => Promise.reject(new Error('Not read in this test.')),
) {
  render(
    <StoreStructureView
      state={{ status: 'ready', target: structure.url, value: structure }}
      readValues={readValues}
      onRetry={() => undefined}
      onBrowseFile={() => undefined}
    />,
  )
  return screen.getByRole('tree', { name: 'Store contents' })
}

const SMALL_STORE = [
  { path: '', kind: 'group' },
  { path: 'obs', kind: 'group' },
  { path: 'obs/cluster', kind: 'group' },
  { path: 'obs/cluster/codes', kind: 'array' },
  { path: 'var', kind: 'group' },
  { path: 'var/gene', kind: 'array' },
] as const

describe('the structure tree', () => {
  const row = (path: string) => screen.getByTitle(`Show details of ${path}`)

  it('is one tab stop, with rows as tree items at their levels', () => {
    const tree = renderStoreView(flatStore([...SMALL_STORE]))
    fireEvent.click(screen.getByRole('button', { name: 'Expand All' }))

    const rows = within(tree).getAllByRole('treeitem')
    expect(rows).toHaveLength(6)
    expect(rows.filter((item) => item.tabIndex === 0)).toEqual([row('/')])
    expect(row('obs/cluster/codes')).toHaveAttribute('aria-level', '4')
    expect(row('obs')).toHaveAttribute('aria-expanded', 'true')
    expect(row('var/gene')).not.toHaveAttribute('aria-expanded')
    expect(tree.querySelectorAll('button')).toHaveLength(0)
  })

  it('moves with the arrow keys, Home and End, and opens and closes groups', () => {
    renderStoreView(flatStore([...SMALL_STORE]))
    const key = (key: string) => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key })
    }
    row('/').focus()

    key('ArrowDown')
    expect(row('obs')).toHaveFocus()
    expect(row('obs')).toHaveAttribute('tabindex', '0')
    expect(row('/')).toHaveAttribute('tabindex', '-1')
    // obs is open (a small store opens the root's child groups).
    key('ArrowRight')
    expect(row('obs/cluster')).toHaveFocus()
    key('ArrowRight')
    expect(row('obs/cluster')).toHaveAttribute('aria-expanded', 'true')
    key('ArrowRight')
    expect(row('obs/cluster/codes')).toHaveFocus()
    key('ArrowLeft')
    expect(row('obs/cluster')).toHaveFocus()
    key('ArrowLeft')
    expect(row('obs/cluster')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTitle('Show details of obs/cluster/codes')).toBeNull()
    key('End')
    expect(row('var/gene')).toHaveFocus()
    key('ArrowUp')
    expect(row('var')).toHaveFocus()
    key('Home')
    expect(row('/')).toHaveFocus()

    // Enter shows a row's details; moving does not.
    key('ArrowDown')
    expect(screen.queryByRole('region', { name: 'obs' })).toBeNull()
    key('Enter')
    expect(screen.getByRole('region', { name: 'obs' })).toBeInTheDocument()
    expect(row('obs')).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the root open on Collapse All while filtering', () => {
    renderStoreView(flatStore([...SMALL_STORE]))
    fireEvent.change(screen.getByPlaceholderText('Filter by name or path'), {
      target: { value: 'codes' },
    })
    expect(row('obs/cluster/codes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }))

    expect(row('/')).toHaveAttribute('aria-expanded', 'true')
    expect(row('obs')).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves focus to the first row Show More adds', () => {
    renderStoreView(
      flatStore([
        { path: '', kind: 'group' },
        ...Array.from({ length: 450 }, (_, index) => ({
          path: `item${String(index).padStart(3, '0')}`,
          kind: 'group' as const,
        })),
      ]),
    )
    const more = screen.getByTitle('Show more of the 450 items in the root')
    expect(more).toHaveTextContent('Show More (250 hidden)')
    more.focus()

    fireEvent.keyDown(more, { key: 'Enter' })

    expect(screen.queryByTitle('Show more of the 450 items in the root')).toBeNull()
    expect(row('item200')).toHaveFocus()
    expect(row('item200')).toHaveAttribute('tabindex', '0')
  })
})

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
    fireEvent.click(screen.getByTitle('Expand cluster'))
    fireEvent.click(screen.getByTitle('Show details of obs/cluster/codes'))

    const details = screen.getByRole('region', { name: 'codes' })
    expect(within(details).getByText('/obs/cluster/codes')).toBeInTheDocument()
    expect(within(details).getByText('Array (Zarr v2)')).toBeInTheDocument()
    expect(within(details).getByText('int8')).toBeInTheDocument()
    expect(
      within(details).getByText(`${STORE_URL}/obs/cluster/codes`),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Collapse obs'))
    expect(screen.queryByTitle('Show details of obs/cluster')).not.toBeInTheDocument()
  })

  it('shows the first values of an array, read as soon as they are cheap', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await within(drawer()).findByText('Consolidated metadata')

    fireEvent.click(screen.getByTitle('Show details of obs/score'))
    const score = screen.getByRole('region', { name: 'score' })
    const column = await within(score).findByRole('table', { name: 'Values' })
    expect(within(score).getByText('All 6 values.')).toBeInTheDocument()
    // float32, as NumPy prints it.
    expect(within(column).getByText('0.9')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show details of X'))
    const matrix = screen.getByRole('region', { name: 'X' })
    const table = await within(matrix).findByRole('table', { name: 'Values' })
    expect(within(matrix).getByText('All 24 values.')).toBeInTheDocument()
    const cells = within(table).getAllByRole('row')[4]?.querySelectorAll('td')
    expect(Array.from(cells ?? [], (cell) => cell.textContent)).toEqual([
      '7',
      '0',
      '8',
      '0',
    ])
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
    fireEvent.click(screen.getByTitle('Collapse obsm'))
    expect(screen.queryByTitle('Show details of obsm/X_umap')).not.toBeInTheDocument()

    // A matching group keeps its contents, closed.
    fireEvent.change(screen.getByPlaceholderText('Filter by name or path'), {
      target: { value: 'cluster' },
    })
    expect(
      screen.queryByTitle('Show details of obs/cluster/codes'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Expand cluster'))
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

    fireEvent.click(screen.getByTitle('Expand cells'))
    fireEvent.click(screen.getByTitle('Show details of shapes/cells/shapes.parquet'))
    const browseFile = screen.getByRole('button', { name: 'Browse File' })
    browseFile.focus()
    fireEvent.click(browseFile)

    const dialog = screen.getByRole('dialog', { name: 'Parquet file' })
    // Focus goes with the view, not left on a button the drawer hid.
    expect(document.activeElement?.closest('[hidden]')).toBeNull()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(
      await within(dialog).findByText('GeoParquet 1.1.0, pandas, Arrow schema'),
    ).toBeInTheDocument()
    expect(readParquet).toHaveBeenCalledWith(
      { url: `${storeUrl}/shapes/cells/shapes.parquet` },
      expect.anything(),
    )
    expect(within(dialog).getByText('WKB geometry')).toBeInTheDocument()
    expect(within(dialog).getByText('pandas index')).toBeInTheDocument()

    const back = within(dialog).getByRole('button', { name: 'Back to Store' })
    back.focus()
    fireEvent.click(back)
    expect(drawer()).toBeVisible()
    // Back where it was in the store.
    expect(screen.getByRole('button', { name: 'Browse File' })).toHaveFocus()
    expect(
      screen.getByTitle('Show details of shapes/cells/shapes.parquet'),
    ).toHaveAttribute('aria-selected', 'true')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('shows the first rows of a file, read as soon as they are cheap', async () => {
    const fetcher = rangeFetcher(spatialDataShapesFixtureBytes('cell_boundaries.parquet'))
    const readParquetRows = vi.fn<RowsReader>((structure, options) =>
      readRows(structure, { ...options, fetcher }),
    )
    render(
      <Harness
        url="https://bucket.test/shapes.parquet"
        readParquet={(file, options) =>
          readParquetStructure(file, { ...options, fetcher })
        }
        readParquetRows={readParquetRows}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    const dialog = screen.getByRole('dialog', { name: 'Parquet file' })
    await within(dialog).findByText('4 rows · 2 columns · 1 row group')
    fireEvent.click(screen.getByTitle('Show details of geometry'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rows' }))
    const table = await within(dialog).findByRole('table', { name: 'First rows' })
    expect(readParquetRows).toHaveBeenCalledTimes(1)
    expect(
      within(dialog).getByText(/^First 4 rows of 4, from row group 0; read /),
    ).toBeInTheDocument()
    const [header, first] = within(table).getAllByRole('row')
    expect(header?.textContent).toBe('Rowgeometrybinary__index_level_0__string')
    expect(within(first ?? table).getByText('Polygon, 5 points')).toBeInTheDocument()
    expect(within(first ?? table).getByText('aaaa-1')).toBeInTheDocument()

    // The tree keeps its selection, and the rows are not read again.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Columns' }))
    expect(screen.getByTitle('Show details of geometry')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rows' }))
    expect(within(dialog).getByRole('table', { name: 'First rows' })).toBeInTheDocument()
    expect(readParquetRows).toHaveBeenCalledTimes(1)
  })

  it('asks before reading rows that may cost a large row group', async () => {
    const fetcher = rangeFetcher(xeniumCellsFixtureBytes('cells.parquet'))
    const readParquetRows = vi.fn<RowsReader>((structure, options) =>
      readRows(structure, { ...options, fetcher }),
    )
    // The first row group's chunks as if they were 20 MB.
    const readParquet = vi.fn<ParquetReader>(async (file, options) => {
      const structure = await readParquetStructure(file, { ...options, fetcher })
      return {
        ...structure,
        rowGroups: structure.rowGroups.map((group, index) =>
          index === 0 ? { ...group, compressedBytes: 20_000_000 } : group,
        ),
      }
    })
    render(
      <Harness
        url="https://bucket.test/cells.parquet"
        readParquet={readParquet}
        readParquetRows={readParquetRows}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    const dialog = screen.getByRole('dialog', { name: 'Parquet file' })
    await within(dialog).findByText('10 rows · 8 columns · 3 row groups')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rows' }))
    expect(within(dialog).getByText(/up to 20 MB/)).toBeInTheDocument()
    expect(readParquetRows).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Read Rows' }))
    const table = await within(dialog).findByRole('table', { name: 'First rows' })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(within(table).getAllByText('null')).toHaveLength(1)
  })

  it('reads an HDF5 file and shows its datasets and first values', async () => {
    const bytes = await createH5Bytes(writeBrowsableH5ad)
    const closes: (() => void)[] = []
    const readH5 = vi.fn<H5Reader>(async (url, options) => {
      const structure = await readH5Structure(url, {
        ...options,
        open: () => openH5WorkerFile(bytes.slice()),
      })
      const close = vi.fn(structure.close)
      closes.push(close)
      return { ...structure, close }
    })
    const { unmount } = render(
      <Harness url="https://bucket.test/run/sample.h5ad" readH5={readH5} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    const dialog = screen.getByRole('dialog', { name: 'HDF5 file' })
    expect(
      await within(dialog).findByText('AnnData (encoding 0.1.0)'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('6 groups · 6 datasets · 2 links'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('missing target')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show details of X/data'))
    const data = screen.getByRole('region', { name: 'data' })
    expect(within(data).getByText('gzip (level 4)')).toBeInTheDocument()
    expect(within(data).getByText('256 · 4 chunks')).toBeInTheDocument()
    expect(within(data).getByText('float32')).toBeInTheDocument()

    // Cheap to read, so read at once.
    fireEvent.click(screen.getByTitle('Show details of obs/_index'))
    const index = screen.getByRole('region', { name: '_index' })
    const table = await within(index).findByRole('table', { name: 'Values' })
    expect(within(table).getByText('cell-99')).toBeInTheDocument()
    expect(within(index).getByText('The first 100, of 250.')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show details of uns/pi'))
    const scalar = screen.getByRole('region', { name: 'pi' })
    expect(await within(scalar).findByText('3.5')).toBeInTheDocument()

    // The worker closes with the drawer's owner.
    unmount()
    expect(closes).toHaveLength(1)
    expect(closes[0]).toHaveBeenCalledTimes(1)
  })
})

describe('Zarr Read Values', () => {
  // A 100,000 × 30,000 float32 matrix in 2,000 × 1,000 chunks: its first
  // block's chunk decodes to 8 MB, so its values wait for Read Values.
  const store = flatStore([
    { path: '', kind: 'group' },
    {
      path: 'X',
      kind: 'array',
      zarrFormat: 2,
      metadata: {
        zarr_format: 2,
        shape: [100_000, 30_000],
        chunks: [2_000, 1_000],
        dtype: '<f4',
        compressor: null,
        filters: null,
        fill_value: 0,
        order: 'C',
      },
    },
  ])

  it('asks before reading an array whose first chunk is large', async () => {
    const readValues = vi.fn<ReadZarrValues>(async () => ({
      shape: [1, 2],
      values: [1.5, 2],
    }))
    renderStoreView(store, readValues)
    fireEvent.click(screen.getByTitle('Show details of X'))
    const details = screen.getByRole('region', { name: 'X' })

    expect(
      within(details).getByText(
        'Reading the first values may read up to about 8 MB of the store.',
      ),
    ).toBeInTheDocument()
    expect(readValues).not.toHaveBeenCalled()

    fireEvent.click(within(details).getByRole('button', { name: 'Read Values' }))

    expect(
      await within(details).findByRole('table', { name: 'Values' }),
    ).toBeInTheDocument()
    expect(
      within(details).getByText('The first 1 × 2, of 100,000 × 30,000.'),
    ).toBeInTheDocument()
    expect(within(details).getByText('1.5')).toBeInTheDocument()
    expect(readValues).toHaveBeenCalledTimes(1)
    expect(readValues).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ path: 'X' }),
      expect.any(AbortSignal),
    )
  })

  it('says which index of a third dimension it shows', async () => {
    const cube = flatStore([
      { path: '', kind: 'group' },
      {
        path: 'cube',
        kind: 'array',
        zarrFormat: 2,
        metadata: {
          zarr_format: 2,
          shape: [500, 50, 3],
          chunks: [500, 50, 3],
          dtype: '|u1',
          compressor: null,
          filters: null,
          fill_value: 0,
          order: 'C',
        },
      },
    ])
    renderStoreView(cube, async () => ({
      shape: [100, 20, 1],
      values: Array.from({ length: 2_000 }, () => 1),
    }))
    fireEvent.click(screen.getByTitle('Show details of cube'))

    expect(
      await screen.findByText(
        'The first 100 × 20 at index 0 of dimension 3, of 500 × 50 × 3.',
      ),
    ).toBeInTheDocument()
  })

  it('reports a failed read and retries it', async () => {
    let fail = true
    const readValues = vi.fn<ReadZarrValues>(async (): Promise<ZarrValuePreview> => {
      if (fail) throw new Error('Zarr chunk X/0.0 could not be read (HTTP 403).')
      return { shape: [1, 1], values: [3] }
    })
    renderStoreView(store, readValues)
    fireEvent.click(screen.getByTitle('Show details of X'))
    const details = screen.getByRole('region', { name: 'X' })
    fireEvent.click(within(details).getByRole('button', { name: 'Read Values' }))

    const alert = await within(details).findByRole('alert')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toHaveFocus()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(
      await within(details).findByRole('table', { name: 'Values' }),
    ).toBeInTheDocument()
    expect(within(details).getByRole('heading', { name: 'Values' })).toHaveFocus()
  })
})

describe('HDF5 Read Values', () => {
  // A 1,000 × 30,000 float32 matrix stored contiguously: its first block
  // spans 12 MB, so its values wait for Read Values.
  function matrixFile(readValues: H5Structure['readValues']): H5Structure {
    return {
      root: {
        path: '',
        name: 'm.h5',
        kind: 'group',
        attributes: {},
        skippedAttributes: [],
        children: [
          {
            path: 'matrix',
            name: 'matrix',
            kind: 'dataset',
            attributes: {},
            skippedAttributes: [],
            dataset: {
              shape: [1000, 30_000],
              maxShape: [1000, 30_000],
              chunks: null,
              dtype: {
                typeClass: H5T_CLASS.FLOAT,
                size: 4,
                signed: false,
                littleEndian: true,
                vlen: false,
              },
              filters: [],
            },
            children: [],
          },
        ],
      },
      groupCount: 1,
      datasetCount: 1,
      otherCount: 0,
      truncated: false,
      url: 'https://bucket.test/m.h5',
      range: { size: 120_000_000, requests: 1, fetchedBytes: 1_000_000 },
      readValues,
      close: () => undefined,
    }
  }

  it('moves focus to "Reading…", then to the values, or to Retry', async () => {
    const reads: {
      resolve: (preview: H5ValuePreview) => void
      reject: (error: Error) => void
    }[] = []
    const structure = matrixFile(
      () =>
        new Promise<H5ValuePreview>((resolve, reject) => {
          reads.push({ resolve, reject })
        }),
    )
    render(
      <H5FileView
        state={{ status: 'ready', target: structure.url, value: structure }}
        onRetry={() => undefined}
      />,
    )
    fireEvent.click(screen.getByTitle('Show details of matrix'))
    const details = screen.getByRole('region', { name: 'matrix' })
    const readValues = within(details).getByRole('button', { name: 'Read Values' })
    readValues.focus()

    fireEvent.click(readValues)
    expect(within(details).getByRole('status')).toHaveFocus()

    await act(async () => {
      reads[0]?.reject(
        new Error('https://bucket.test/m.h5 could not be read (HTTP 503).'),
      )
      await Promise.resolve()
    })
    const retry = within(details).getByRole('button', { name: 'Retry' })
    expect(retry).toHaveFocus()

    fireEvent.click(retry)
    expect(within(details).getByRole('status')).toHaveFocus()
    await act(async () => {
      reads[1]?.resolve({ shape: [1, 2], values: [1, 2] })
      await Promise.resolve()
    })
    expect(within(details).getByRole('heading', { name: 'Values' })).toHaveFocus()
    expect(within(details).getByRole('table', { name: 'Values' })).toBeInTheDocument()
  })
})
