import type { File as H5wasmFile } from 'h5wasm'

let nextFixtureNumber = 1

// Writes an HDF5 file with h5wasm and returns its bytes.
export async function createH5Bytes(
  build: (file: H5wasmFile) => void,
): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/vitest-h5-fixture-${nextFixtureNumber}.h5`
  nextFixtureNumber += 1

  const file = new h5wasm.File(fileName, 'w')

  try {
    build(file)
  } finally {
    file.close()
  }

  const bytes = FS!.readFile(fileName)
  FS!.unlink(fileName)
  return bytes
}

// A 10x feature-barcode matrix: two cells, two genes and a control probe.
export function writeFeatureBarcodeMatrix(
  file: H5wasmFile,
  barcodes: readonly string[],
): void {
  const matrix = file.create_group('matrix')
  const features = matrix.create_group('features')

  matrix.create_dataset({ name: 'barcodes', data: [...barcodes] })
  features.create_dataset({ name: 'name', data: ['Actb', 'Gad1', 'NegControlProbe_001'] })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })
  matrix.create_dataset({ name: 'indptr', data: new BigInt64Array([0n, 2n, 4n]) })
  matrix.create_dataset({ name: 'indices', data: new Int32Array([0, 2, 0, 1]) })
  matrix.create_dataset({ name: 'data', data: new Int32Array([5, 99, 2, 3]) })
}

export interface LargeFeatureBarcodeMatrix {
  readonly barcodes: readonly string[]
  // The genes and counts of the cell in `row`, as the matrix holds them.
  cell(row: number): { readonly geneNames: string[]; readonly counts: number[] }
}

const LARGE_MATRIX_GENES = Array.from({ length: 50 }, (_, index) => `Gene${index}`)
const LARGE_MATRIX_PADDING_BYTES = 2 * 1024 * 1024

// A feature-barcode matrix of many cells, with chunked gzip arrays like the
// ones Cell Ranger and Xenium write, and 2 MiB of incompressible bytes that no
// reader asks for, so a range-read file can be checked to skip them.
export function writeLargeFeatureBarcodeMatrix(
  file: H5wasmFile,
  cellCount = 40_000,
): LargeFeatureBarcodeMatrix {
  const barcodes = Array.from(
    { length: cellCount },
    (_, row) => `cell${String(row).padStart(6, '0')}-1`,
  )
  const cell = (row: number) => {
    const length = 1 + (row % 5)
    const geneIndices = Array.from({ length }, (_, j) => (row * 7 + j * 13) % 50)

    return {
      geneIndices,
      geneNames: geneIndices.map((index) => LARGE_MATRIX_GENES[index] ?? ''),
      counts: geneIndices.map((_, j) => 1 + ((row + j) % 9)),
    }
  }
  const indptr = new BigInt64Array(cellCount + 1)
  const indices: number[] = []
  const data: number[] = []

  for (let row = 0; row < cellCount; row += 1) {
    const { geneIndices, counts } = cell(row)
    indices.push(...geneIndices)
    data.push(...counts)
    indptr[row + 1] = BigInt(indices.length)
  }

  const matrix = file.create_group('matrix')
  const features = matrix.create_group('features')
  const chunked = (length: number) => ({
    chunks: [Math.min(length, 4096)],
    compression: 'gzip' as const,
  })

  matrix.create_dataset({ name: 'barcodes', data: barcodes })
  features.create_dataset({ name: 'name', data: LARGE_MATRIX_GENES })
  features.create_dataset({
    name: 'feature_type',
    data: LARGE_MATRIX_GENES.map(() => 'Gene Expression'),
  })
  matrix.create_dataset({ name: 'indptr', data: indptr, ...chunked(indptr.length) })
  matrix.create_dataset({
    name: 'indices',
    data: new Int32Array(indices),
    ...chunked(indices.length),
  })
  matrix.create_dataset({
    name: 'data',
    data: new Int32Array(data),
    ...chunked(data.length),
  })

  const padding = new Uint8Array(LARGE_MATRIX_PADDING_BYTES)
  let state = 0x9e3779b9

  for (let index = 0; index < padding.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    padding[index] = state & 0xff
  }

  file.create_dataset({ name: 'padding', data: padding })

  return {
    barcodes,
    cell: (row) => {
      const { geneNames, counts } = cell(row)
      return { geneNames, counts }
    },
  }
}

// A Visium HD feature_slice.h5 at a 2 µm pitch: Actb, Gad1 and a control
// probe, each a COO slice of 2 µm rows, columns and counts.
export function writeTinyFeatureSlice(file: H5wasmFile): void {
  file.create_attribute(
    'metadata_json',
    JSON.stringify({
      nrows: 32,
      ncols: 32,
      spot_pitch: 2,
      transform_matrices: {
        spot_colrow_to_microscope_colrow: [
          [8, 0, 100],
          [0, 8, 200],
          [0, 0, 1],
        ],
      },
    }),
  )
  const features = file.create_group('features')
  features.create_dataset({
    name: 'name',
    data: ['Actb', 'Gad1', 'NegControlProbe_001'],
  })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })

  const featureSlices = file.create_group('feature_slices')
  const actb = featureSlices.create_group('0')
  actb.create_dataset({ name: 'row', data: new Int32Array([0, 7, 8, 9, 16]) })
  actb.create_dataset({ name: 'col', data: new Int32Array([0, 0, 0, 1, 0]) })
  actb.create_dataset({ name: 'data', data: new Int32Array([2, 3, 5, 7, 11]) })

  const gad1 = featureSlices.create_group('1')
  gad1.create_dataset({ name: 'row', data: new Int32Array([8]) })
  gad1.create_dataset({ name: 'col', data: new Int32Array([0]) })
  gad1.create_dataset({ name: 'data', data: new Int32Array([4]) })

  const negative = featureSlices.create_group('2')
  negative.create_dataset({ name: 'row', data: new Int32Array([0]) })
  negative.create_dataset({ name: 'col', data: new Int32Array([0]) })
  negative.create_dataset({ name: 'data', data: new Int32Array([99]) })
}

// A small AnnData-like H5AD for Browse File: encoded groups, a chunked gzip
// CSR matrix, variable-length strings, a 2D array, a scalar, and the links
// HDF5 allows.
export function writeBrowsableH5ad(file: H5wasmFile): void {
  file.create_attribute('encoding-type', 'anndata')
  file.create_attribute('encoding-version', '0.1.0')

  const obs = file.create_group('obs')
  obs.create_attribute('encoding-type', 'dataframe')
  obs.create_attribute('_index', '_index')
  obs.create_dataset({
    name: '_index',
    data: Array.from({ length: 250 }, (_, index) => `cell-${index}`),
  })

  const x = file.create_group('X')
  x.create_attribute('encoding-type', 'csr_matrix')
  x.create_attribute('shape', new BigInt64Array([250n, 30n]))
  x.create_dataset({
    name: 'data',
    data: new Float32Array(Array.from({ length: 1000 }, (_, index) => index / 2)),
    chunks: [256],
    compression: 'gzip',
    compression_opts: 4,
  })
  x.create_dataset({ name: 'indptr', data: new BigInt64Array(251) })

  const obsm = file.create_group('obsm')
  obsm.create_dataset({
    name: 'X_umap',
    data: new Float64Array(Array.from({ length: 150 * 30 }, (_, index) => index)),
    shape: [150, 30],
  })

  const uns = file.create_group('uns')
  uns.create_dataset({ name: 'pi', data: 3.5 })
  uns.create_group('empty')

  file.create_soft_link('/obsm/X_umap', 'umap_link')
  file.create_soft_link('/missing', 'broken_link')
  file.create_external_link('other.h5', '/data', 'external_link')
}
