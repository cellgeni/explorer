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
  columns: ['cell_id', 'is_gene', 'qv', 'x_location', 'y_location'],
  rowStart: 0,
  rowEnd: 262144,
  onComplete(rows) {
    let un = 0,
      unPass = 0,
      minx = 1e9,
      maxx = -1e9,
      miny = 1e9,
      maxy = -1e9
    for (const [id, g, qv, x, y] of rows) {
      minx = Math.min(minx, x)
      maxx = Math.max(maxx, x)
      miny = Math.min(miny, y)
      maxy = Math.max(maxy, y)
      if (id === 'UNASSIGNED') {
        un++
        if (g && qv >= 20) unPass++
      }
    }
    console.log(
      JSON.stringify({
        rows: rows.length,
        unassigned: un,
        unassignedGeneQv20: unPass,
        bbox: [minx, maxx, miny, maxy],
      }),
    )
  },
})
