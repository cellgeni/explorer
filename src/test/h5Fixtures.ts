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
