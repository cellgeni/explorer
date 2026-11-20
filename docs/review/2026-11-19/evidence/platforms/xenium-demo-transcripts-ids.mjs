import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Repository root, five levels up from this file.
const R = fileURLToPath(new URL('../../../../..', import.meta.url)).replace(/\/$/, '')
const { parquetRead, parquetMetadata } = await import(
  R + '/node_modules/hyparquet/src/index.js'
)
const { compressors } = await import(
  R + '/node_modules/hyparquet-compressors/src/index.js'
)
const head = readFileSync('tx_head.bin')
const foot = readFileSync('tx_footer.bin')
const size = 7118586700
const footStart = size - foot.length
const file = {
  byteLength: size,
  slice(s, e = size) {
    if (e <= head.length)
      return head.buffer.slice(head.byteOffset + s, head.byteOffset + e)
    if (s >= footStart)
      return foot.buffer.slice(
        foot.byteOffset + s - footStart,
        foot.byteOffset + e - footStart,
      )
    throw new Error('out of range')
  },
}
const metadata = parquetMetadata(file.slice(footStart))
await parquetRead({
  file,
  metadata,
  compressors,
  columns: [
    'transcript_id',
    'fov_name',
    'x_location',
    'y_location',
    'feature_name',
    'codeword_index',
  ],
  rowStart: 0,
  rowEnd: 262144,
  onComplete(rows) {
    console.log(
      JSON.stringify(rows.slice(0, 3), (k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    )
    let mn = rows[0][0],
      mx = rows[0][0]
    for (const r of rows) {
      if (r[0] < mn) mn = r[0]
      if (r[0] > mx) mx = r[0]
    }
    console.log(
      'transcript_id min',
      mn.toString(),
      'max',
      mx.toString(),
      'hex',
      mn.toString(16),
      mx.toString(16),
      'low32 of min',
      (BigInt(mn) & 0xffffffffn).toString(),
      'high32',
      (BigInt(mn) >> 32n).toString(),
    )
    const fovs = new Set(rows.map((r) => r[1]))
    console.log('fov names', [...fovs])
  },
})
