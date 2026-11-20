// Live probe (reference kidney run): do transcript cell_id pairs and matrix
// obs/cell_id int64 values map to the matrix obs/barcode strings? The oracle
// is written here (hex nibble -> 'a'+nibble) and checked against the barcodes
// themselves; the production intToCellId is compared afterwards.
// Reads: two zip central directories, obs/barcode + obs/cell_id (one chunk
// each), one tile's gene_offset, and one cell_id chunk (rows 0..131071) of a
// transcripts tile. Run: node docs/review/2026-11-19/evidence/platforms/atera-probe-cell-ids.mjs
import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { intToCellId } from '../../../../../src/data/cellid.ts'

const B =
  'https://mp33.cog.sanger.ac.uk/public/test/50170325_WSI_KID_04_region1/50170325_WSI_KID_04_region1'
const oracle = (prefix, suffix) =>
  [...(prefix >>> 0).toString(16).padStart(8, '0')]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join('') + `-${suffix}`

const matrix = zarr.root(ZipFileStore.fromUrl(`${B}/cell_feature_matrix.zarr.zip`))
const barcodes = (
  await zarr.get(await zarr.open.v2(matrix.resolve('obs/barcode'), { kind: 'array' }), [
    null,
  ])
).data
const obsCellId = (
  await zarr.get(await zarr.open.v2(matrix.resolve('obs/cell_id'), { kind: 'array' }), [
    null,
  ])
).data
const barcodeSet = new Set(barcodes)
let obsMismatch = 0
const obsExamples = []
for (let row = 0; row < barcodes.length; row += 1) {
  const value = BigInt.asUintN(64, obsCellId[row])
  const prefix = Number(value & 0xffffffffn)
  const suffix = Number(value >> 32n)
  const text = oracle(prefix, suffix)
  if (text !== barcodes[row]) obsMismatch += 1
  if (row < 3)
    obsExamples.push({
      row,
      int64: String(obsCellId[row]),
      prefix,
      suffix,
      oracle: text,
      barcode: barcodes[row],
    })
}
console.log(
  JSON.stringify({
    cells: barcodes.length,
    obsCellIdMismatches: obsMismatch,
    obsExamples,
    maxObsCellId: String(obsCellId.reduce((a, b) => (b > a ? b : a), 0n)),
  }),
)

const tx = zarr.root(ZipFileStore.fromUrl(`${B}/transcripts.zarr.zip`))
const tile = '3,2'
const cellIdArray = await zarr.open.v2(tx.resolve(`grid/${tile}/cell_id`), {
  kind: 'array',
})
const chunk = await zarr.get(cellIdArray, [zarr.slice(0, 131072), null])
const n = chunk.shape[0]
const [rowStride, colStride] = chunk.stride
const counts = {
  rows: n,
  assignedInMatrix: 0,
  assignedNotInMatrix: 0,
  bothMax: 0,
  prefixMaxOnly: 0,
  suffixMaxOnly: 0,
  productionDisagrees: 0,
}
const suffixes = new Map()
const notInMatrix = []
for (let row = 0; row < n; row += 1) {
  const prefix = chunk.data[row * rowStride]
  const suffix = chunk.data[row * rowStride + colStride]
  const pMax = prefix === 0xffffffff
  const sMax = suffix === 0xffffffff
  if (pMax && sMax) {
    counts.bothMax += 1
    continue
  }
  if (pMax) {
    counts.prefixMaxOnly += 1
    continue
  }
  if (sMax) {
    counts.suffixMaxOnly += 1
    continue
  }
  suffixes.set(suffix, (suffixes.get(suffix) ?? 0) + 1)
  const text = oracle(prefix, suffix)
  if (intToCellId(prefix, suffix) !== text) counts.productionDisagrees += 1
  if (barcodeSet.has(text)) counts.assignedInMatrix += 1
  else {
    counts.assignedNotInMatrix += 1
    if (notInMatrix.length < 5) notInMatrix.push(text)
  }
}
console.log(
  JSON.stringify({
    tile,
    chunkStride: chunk.stride,
    ...counts,
    suffixes: [...suffixes],
    notInMatrix,
  }),
)
