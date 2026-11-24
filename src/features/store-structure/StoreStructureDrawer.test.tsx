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
import { H5FileView } from './H5StructureView'
import { StoreStructureDrawer } from './StoreStructureDrawer'
import { useStoreStructure } from './useStoreStructure'

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
      'aria-current',
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
