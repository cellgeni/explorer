// In-memory Zarr v2 and zip fixtures for Atera tests. Stores are maps from
// entry path (no leading slash) to bytes, uncompressed.

export type Dtype =
  | '<i8'
  | '<i4'
  | '<u4'
  | '<i2'
  | '<u2'
  | '<f2'
  | '<f4'
  | '<f8'
  | '|u1'
  | '|i1'
  | '|b1'

export type ZarrEntries = Map<string, Uint8Array>

export function v2Array(
  dtype: string,
  shape: readonly number[],
  chunks: readonly number[],
  options: { readonly order?: 'C' | 'F'; readonly filters?: readonly unknown[] } = {},
) {
  return {
    zarr_format: 2,
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: 0,
    order: options.order ?? 'C',
    filters: options.filters ?? null,
  }
}

export function group(
  entries: ZarrEntries,
  path: string,
  attrs: Readonly<Record<string, unknown>>,
): void {
  const prefix = path === '' ? '' : `${path}/`
  entries.set(`${prefix}.zgroup`, json({ zarr_format: 2 }))
  entries.set(`${prefix}.zattrs`, json(attrs))
}

export function array(
  entries: ZarrEntries,
  path: string,
  dtype: Dtype,
  values: readonly number[],
  shape: readonly number[] = [values.length],
): void {
  entries.set(`${path}/.zarray`, json(v2Array(dtype, shape, shape)))
  entries.set(`${path}/${shape.map(() => '0').join('.')}`, typed(dtype, values))
}

// A 1D array stored with numcodecs Delta, as binned_transcripts stores CSR
// indices and indptr: differences written as the signed type of the dtype.
export function deltaArray(
  entries: ZarrEntries,
  path: string,
  dtype: '<u2' | '<u4',
  values: readonly number[],
): void {
  const signed = dtype === '<u2' ? '<i2' : '<i4'
  const deltas = values.map((value, index) =>
    index === 0 ? value : value - (values[index - 1] ?? 0),
  )
  entries.set(
    `${path}/.zarray`,
    json(
      v2Array(dtype, [values.length], [values.length], {
        filters: [{ id: 'delta', dtype, astype: signed }],
      }),
    ),
  )
  entries.set(`${path}/0`, typed(signed, deltas))
}

// A [rows, columns] array split into chunks of `chunkRows` rows, each chunk
// laid out in the array's order.
export function matrixArray(
  entries: ZarrEntries,
  path: string,
  dtype: Dtype,
  rows: readonly (readonly number[])[],
  options: { readonly chunkRows: number; readonly order?: 'C' | 'F' },
): void {
  const columns = rows[0]?.length ?? 1
  const order = options.order ?? 'C'
  entries.set(
    `${path}/.zarray`,
    json(v2Array(dtype, [rows.length, columns], [options.chunkRows, columns], { order })),
  )

  for (let start = 0; start < rows.length; start += options.chunkRows) {
    const chunk = Array.from(
      { length: options.chunkRows },
      (_, index) => rows[start + index] ?? new Array<number>(columns).fill(0),
    )
    const values =
      order === 'C'
        ? chunk.flat()
        : Array.from({ length: columns }, (_, column) =>
            chunk.map((row) => row[column] ?? 0),
          ).flat()
    entries.set(`${path}/${start / options.chunkRows}.0`, typed(dtype, values))
  }
}

export function strings(
  entries: ZarrEntries,
  path: string,
  values: readonly string[],
): void {
  entries.set(
    `${path}/.zarray`,
    json({
      ...v2Array('|O', [values.length], [values.length]),
      filters: [{ id: 'vlen-utf8' }],
    }),
  )
  entries.set(`${path}/0`, vlenUtf8(values))
}

export function categorical(
  entries: ZarrEntries,
  path: string,
  codes: readonly number[],
  categories: readonly string[],
): void {
  group(entries, path, { 'encoding-type': 'categorical', ordered: false })
  array(entries, `${path}/codes`, '|i1', codes)
  strings(entries, `${path}/categories`, categories)
}

// `<f2` values are given as IEEE 754 half-precision bits.
export function typed(dtype: Dtype, values: readonly number[]): Uint8Array {
  switch (dtype) {
    case '<i8':
      return bytes(BigInt64Array.from(values, (value) => BigInt(value)))
    case '<i4':
      return bytes(Int32Array.from(values))
    case '<u4':
      return bytes(Uint32Array.from(values))
    case '<i2':
      return bytes(Int16Array.from(values))
    case '<u2':
    case '<f2':
      return bytes(Uint16Array.from(values))
    case '<f4':
      return bytes(Float32Array.from(values))
    case '<f8':
      return bytes(Float64Array.from(values))
    case '|i1':
      return bytes(Int8Array.from(values))
    case '|u1':
    case '|b1':
      return Uint8Array.from(values)
  }
}

// numcodecs VLenUTF8: item count, then each item's byte length and bytes.
export function vlenUtf8(values: readonly string[]): Uint8Array {
  const encoded = values.map((value) => new TextEncoder().encode(value))
  const output = new Uint8Array(
    4 + encoded.reduce((sum, item) => sum + 4 + item.length, 0),
  )
  const view = new DataView(output.buffer)
  let offset = 0
  view.setUint32(offset, values.length, true)
  offset += 4

  for (const item of encoded) {
    view.setUint32(offset, item.length, true)
    output.set(item, offset + 4)
    offset += 4 + item.length
  }

  return output
}

export function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

// A store over fixture entries that records each requested key.
export function mapStore(
  entries: ZarrEntries,
  requestedKeys: string[] = [],
  label = '',
): { get: (key: string) => Promise<Uint8Array | undefined> } {
  return {
    get: async (key: string) => {
      requestedKeys.push(label === '' ? key : `${label}:${key}`)
      return entries.get(key.replace(/^\//, ''))
    },
  }
}

// A zip archive with every entry STORED (uncompressed), like the per-gene
// zips inside binned_transcripts.zarr.zip.
export function storedZip(entries: ZarrEntries): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)

    localParts.push(local, data)
    centralParts.push(central)
    offset += local.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.size, true)
  endView.setUint16(10, entries.size, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  return concat([...localParts, ...centralParts, end])
}

function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff

  for (const byte of data) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1
    }
  }

  return (crc ^ 0xffff_ffff) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

function bytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}
