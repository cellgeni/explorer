import * as zarr from 'zarrita'
import { h5PreviewBlock } from '../data/h5StructureTypes'
import { abortable } from '../utils/abortable'
import { consolidatedZarrStore, createZarrFetchStore } from './zarrStores'
import type { ZarrStructure, ZarrStructureNode } from './zarrStructure'

// The first values of an array in Browse Store, as Browse File shows an HDF5
// dataset's: a block from its origin, at most 100 along the first dimension,
// 20 along the second, and 1 along any other. The array is read from the
// store the structure was read from, with its metadata from the structure,
// so only the chunks the block touches are fetched.

export interface ZarrValuePreview {
  // The block's shape; [] for a scalar.
  readonly shape: readonly number[]
  // Row-major: numbers, bigints, booleans and strings, Uint8Arrays for
  // variable-length bytes, and what the JSON codec gives for objects.
  readonly values: readonly unknown[]
}

export interface ReadZarrValuesOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export async function readZarrValues(
  structure: ZarrStructure,
  node: ZarrStructureNode,
  options: ReadZarrValuesOptions = {},
): Promise<ZarrValuePreview> {
  const { metadata, array: summary } = node

  if (node.kind !== 'array' || metadata === undefined || summary === undefined) {
    throw new Error(`/${node.path} is not an array, so it has no values.`)
  }

  const block = h5PreviewBlock(summary.shape)

  if (block.some((size) => size === 0)) {
    return { shape: block, values: [] }
  }

  const isV3 = metadata.zarr_format === 3
  const metadataKey = `${node.path === '' ? '' : `/${node.path}`}/${isV3 ? 'zarr.json' : '.zarray'}`
  const store = consolidatedZarrStore(
    await baseStore(structure, options),
    new Map([[metadataKey, metadata]]),
  )
  const location = zarr.root(store).resolve(node.path)
  const signal = options.signal === undefined ? {} : { signal: options.signal }
  const array = isV3
    ? await zarr.open.v3(location, { kind: 'array', ...signal })
    : await zarr.open.v2(location, { kind: 'array', attrs: false, ...signal })

  if (array.shape.length === 0) {
    return { shape: [], values: [await zarr.get(array, null, signal)] }
  }

  const chunk = await zarr.get(
    array,
    block.map((size) => zarr.slice(size)),
    signal,
  )
  return { shape: block, values: rowMajorValues(chunk) }
}

// The store under the structure: a zip and an Icechunk repository opened
// before are reused, so their directory and snapshot are not read again.
async function baseStore(
  structure: ZarrStructure,
  options: ReadZarrValuesOptions,
): Promise<zarr.AsyncReadable> {
  const fetcher = options.fetcher === undefined ? {} : { fetcher: options.fetcher }

  switch (structure.source) {
    case 'zip': {
      const { openZippedZarrStore } = await import('./zarrZipStore')
      const zip = await abortable(
        openZippedZarrStore(structure.url, fetcher),
        options.signal,
      )
      return zip.store
    }
    case 'icechunk': {
      const { openIcechunkRepository } = await import('./icechunkStore')
      const repository = await openIcechunkRepository(structure.url, {
        ...fetcher,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      return repository.store
    }
    case 'consolidated':
    case 'walked':
      return createZarrFetchStore(structure.url, fetcher)
  }
}

interface ChunkLike {
  readonly data: unknown
  readonly shape: readonly number[]
  readonly stride: readonly number[]
}

// The chunk's elements in row-major order, whatever its strides (a v2
// array in F order keeps them).
function rowMajorValues({ data, shape, stride }: ChunkLike): unknown[] {
  const count = shape.reduce((product, size) => product * size, 1)
  const index = shape.map(() => 0)
  const values: unknown[] = []

  for (let item = 0; item < count; item += 1) {
    let offset = 0

    for (let dimension = 0; dimension < shape.length; dimension += 1) {
      offset += (index[dimension] ?? 0) * (stride[dimension] ?? 0)
    }

    values.push(elementAt(data, offset))

    for (let dimension = shape.length - 1; dimension >= 0; dimension -= 1) {
      const next = (index[dimension] ?? 0) + 1

      if (next < (shape[dimension] ?? 1)) {
        index[dimension] = next
        break
      }

      index[dimension] = 0
    }
  }

  return values
}

// zarrita's boolean and fixed-length string arrays are read with `get`.
function elementAt(data: unknown, offset: number): unknown {
  if (typeof data !== 'object' || data === null) {
    return undefined
  }

  if ('get' in data && typeof data.get === 'function') {
    return (data as { get(index: number): unknown }).get(offset)
  }

  return (data as ArrayLike<unknown>)[offset]
}
