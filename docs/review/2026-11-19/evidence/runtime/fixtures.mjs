// Writes the runtime review's local fixtures into one folder, to be served by
// scripts/range-server.mjs (byte ranges, CORS, CORP, HEAD, 404 for missing).
//
//   node docs/review/2026-11-19/evidence/runtime/fixtures.mjs <outDir> [--profile]
//
// Small fixtures mirror the ones tests/e2e/app.spec.ts routes in memory
// (tiny H5AD, Space Ranger folder, MERSCOPE folders, Icechunk AnnData,
// SpatialData image store, imported-segmentation slide), plus a three-section
// collection with depths for the side-by-side and 3D stack views, and a
// broken H5AD for error states. --profile also writes profile.h5ad, a
// synthetic AnnData of 200,000 cells x 500 genes (CSR, ~10% dense) that is
// over the 64 MiB range-read threshold, for bounded profiling.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const out = resolve(process.argv[2] ?? 'rt-fixtures')
const repo = resolve(new URL('../../../../../', import.meta.url).pathname)
const withProfile = process.argv.includes('--profile')
mkdirSync(out, { recursive: true })

const h5wasm = (await import('h5wasm')).default
const { FS } = await h5wasm.ready

function writeH5(name, build) {
  const fileName = `/rt-${randomUUID()}.h5`
  const file = new h5wasm.File(fileName, 'w')
  build(file)
  file.close()
  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  writeFileSync(join(out, name), bytes)
  return bytes.byteLength
}

// Seeded PRNG so every run writes the same bytes.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function attrs(node, entries) {
  for (const [key, value] of Object.entries(entries)) node.create_attribute(key, value)
}

// Modern AnnData encoding (0.8+): dataframe obs/var, categorical groups,
// csr_matrix X, dict obsm.
function writeAnnData(file, { cells, genes, clusters, coords, umap, csr, numeric }) {
  attrs(file, { 'encoding-type': 'anndata', 'encoding-version': '0.1.0' })
  const obs = file.create_group('obs')
  attrs(obs, {
    'encoding-type': 'dataframe',
    'encoding-version': '0.2.0',
    _index: 'cell_id',
    'column-order': ['cluster', 'n_genes'],
  })
  obs.create_dataset({ name: 'cell_id', data: cells })
  attrs(obs.get('cell_id'), {
    'encoding-type': 'string-array',
    'encoding-version': '0.2.0',
  })
  const cluster = obs.create_group('cluster')
  attrs(cluster, { 'encoding-type': 'categorical', 'encoding-version': '0.2.0' })
  cluster.create_attribute('ordered', new Int8Array([0]), [])
  cluster.create_dataset({ name: 'codes', data: clusters.codes })
  cluster.create_dataset({ name: 'categories', data: clusters.categories })
  attrs(cluster.get('categories'), {
    'encoding-type': 'string-array',
    'encoding-version': '0.2.0',
  })
  obs.create_dataset({ name: 'n_genes', data: numeric })
  attrs(obs.get('n_genes'), { 'encoding-type': 'array', 'encoding-version': '0.2.0' })

  const v = file.create_group('var')
  attrs(v, {
    'encoding-type': 'dataframe',
    'encoding-version': '0.2.0',
    _index: 'gene_ids',
    'column-order': [],
  })
  v.create_dataset({ name: 'gene_ids', data: genes })
  attrs(v.get('gene_ids'), {
    'encoding-type': 'string-array',
    'encoding-version': '0.2.0',
  })

  const obsm = file.create_group('obsm')
  attrs(obsm, { 'encoding-type': 'dict', 'encoding-version': '0.1.0' })
  obsm.create_dataset({ name: 'spatial', data: coords, shape: [cells.length, 2] })
  attrs(obsm.get('spatial'), { 'encoding-type': 'array', 'encoding-version': '0.2.0' })
  obsm.create_dataset({ name: 'X_umap', data: umap, shape: [cells.length, 2] })
  attrs(obsm.get('X_umap'), { 'encoding-type': 'array', 'encoding-version': '0.2.0' })

  const X = file.create_group('X')
  attrs(X, { 'encoding-type': 'csr_matrix', 'encoding-version': '0.1.0' })
  X.create_attribute(
    'shape',
    new BigInt64Array([BigInt(cells.length), BigInt(genes.length)]),
  )
  X.create_dataset({ name: 'data', data: csr.data })
  X.create_dataset({ name: 'indices', data: csr.indices })
  X.create_dataset({ name: 'indptr', data: csr.indptr })
}

// A section of `n` cells on a jittered grid, `spacing` µm apart, with a
// cluster per quadrant and genes expressed by position, so different
// sections give different but plausible patterns.
function syntheticAnnData({ n, g, density, seed, prefix, offset = [0, 0] }) {
  const random = rng(seed)
  const side = Math.ceil(Math.sqrt(n))
  const cells = Array.from({ length: n }, (_, i) => `${prefix}-${i}`)
  const genes = Array.from({ length: g }, (_, i) =>
    i < 4 ? ['Actb', 'Gad1', 'Gapdh', 'Snap25'][i] : `Gene${i}`,
  )
  const coords = new Float32Array(n * 2)
  const umap = new Float32Array(n * 2)
  const codes = new Int8Array(n)
  const numeric = new Int32Array(n)
  const data = []
  const indices = []
  const indptr = new BigInt64Array(n + 1)
  let nnz = 0
  for (let i = 0; i < n; i += 1) {
    const x = (i % side) * 10 + random() * 4 + offset[0]
    const y = Math.floor(i / side) * 10 + random() * 4 + offset[1]
    coords[i * 2] = x
    coords[i * 2 + 1] = y
    const c = (x > (side * 10) / 2 ? 1 : 0) + (y > (side * 10) / 2 ? 2 : 0)
    codes[i] = c
    umap[i * 2] = c * 10 + random() * 5
    umap[i * 2 + 1] = (c % 2) * 10 + random() * 5
    let count = 0
    for (let j = 0; j < g; j += 1) {
      const p = j < 4 ? (j === c ? 0.9 : 0.2) : density
      if (random() < p) {
        indices.push(j)
        data.push(Math.floor(1 + random() * 9))
        count += 1
      }
    }
    nnz += count
    numeric[i] = count
    indptr[i + 1] = BigInt(nnz)
  }
  return {
    cells,
    genes,
    coords,
    umap,
    numeric,
    clusters: { codes, categories: ['A', 'B', 'C', 'D'] },
    csr: { data: Float32Array.from(data), indices: Int32Array.from(indices), indptr },
  }
}

const sizes = {}

// 1. Tiny H5AD (the smoke tests' 4 cells x 3 genes, old-style categories).
sizes['h5ad-smoke.h5ad'] = writeH5('h5ad-smoke.h5ad', (file) => {
  const obs = file.create_group('obs')
  obs.create_attribute('_index', 'cell_id')
  obs.create_attribute('column-order', ['cluster', 'n_genes', 'score'])
  obs.create_dataset({ name: 'cell_id', data: ['cell-a', 'cell-b', 'cell-c', 'cell-d'] })
  obs.create_dataset({ name: 'n_genes', data: new Int32Array([120, 340, 560, 780]) })
  obs.create_dataset({ name: 'score', data: new Float32Array([0.1, 0.5, 0.9, 0.2]) })
  obs.create_dataset({ name: 'cluster', data: new Int8Array([0, 1, 0, 1]) })
  const categories = obs.create_group('__categories')
  categories.create_dataset({ name: 'cluster', data: ['A', 'B'] })
  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', 'gene_ids')
  varGroup.create_dataset({ name: 'gene_ids', data: ['Actb', 'Gad1', 'Gapdh'] })
  const obsm = file.create_group('obsm')
  obsm.create_dataset({
    name: 'X_umap',
    data: new Float32Array([0, 0, 10, 0, 0, 10, 10, 10]),
    shape: [4, 2],
  })
  file.create_dataset({
    name: 'X',
    data: new Float32Array([1, 0, 5, 2, 3, 0, 0, 4, 6, 7, 0, 8]),
    shape: [4, 3],
  })
})

// 2. Three registered sections with depths, 2,500 cells x 50 genes each.
for (const [index, z] of [0, 10, 20].entries()) {
  const name = `sections/s${index + 1}.h5ad`
  mkdirSync(join(out, 'sections'), { recursive: true })
  sizes[name] = writeH5(name, (file) =>
    writeAnnData(
      file,
      syntheticAnnData({
        n: 2500,
        g: 50,
        density: 0.1,
        seed: 11 + index,
        prefix: `s${index + 1}`,
      }),
    ),
  )
  void z
}
writeFileSync(
  join(out, 'sections', 'collection.json'),
  JSON.stringify(
    {
      version: 1,
      name: 'Review stack',
      datasets: [0, 10, 20].map((z, i) => ({
        dataset: `s${i + 1}.h5ad`,
        name: `S${i + 1}`,
        coordinateSystem: 'block',
        z,
      })),
    },
    null,
    2,
  ),
)

// 3. A medium H5AD under 64 MiB (whole-file path), 20,000 cells x 200 genes.
sizes['medium.h5ad'] = writeH5('medium.h5ad', (file) =>
  writeAnnData(
    file,
    syntheticAnnData({ n: 20000, g: 200, density: 0.08, seed: 5, prefix: 'm' }),
  ),
)

// 4. Broken H5AD: HDF5 signature then garbage (error-state checks).
writeFileSync(
  join(out, 'broken.h5ad'),
  Buffer.concat([
    Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(4096, 7),
  ]),
)

// 5. Space Ranger Visium folder: 36 spots, as routeVisiumSpaceRangerFixture.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
{
  const spots = Array.from({ length: 6 }, (_r, row) =>
    Array.from({ length: 6 }, (_c, index) => {
      const col = (row % 2) + index * 2
      return {
        barcode: `SPOT${row}${index}-1`,
        row,
        col,
        x: 400 + col * 100,
        y: 300 + row * 100 * Math.sqrt(3),
      }
    }),
  ).flat()
  const dir = join(out, 'visium-smoke')
  mkdirSync(join(dir, 'spatial'), { recursive: true })
  writeFileSync(
    join(dir, 'spatial/tissue_positions.csv'),
    [
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
      ...spots.map((s) => `${s.barcode},1,${s.row},${s.col},${s.y},${s.x}`),
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'spatial/scalefactors_json.json'),
    JSON.stringify({
      spot_diameter_fullres: 130,
      tissue_hires_scalef: 0.001,
      tissue_lowres_scalef: 0.0005,
    }),
  )
  writeFileSync(
    join(dir, 'spatial/tissue_hires_image.png'),
    Buffer.from(TINY_PNG_BASE64, 'base64'),
  )
  writeH5('visium-smoke/filtered_feature_bc_matrix.h5', (file) => {
    const indices = []
    const data = []
    const indptr = [0n]
    spots.forEach((_s, i) => {
      indices.push(0n)
      data.push(i + 1)
      if (i % 2 === 0) {
        indices.push(1n)
        data.push(3)
      }
      indptr.push(BigInt(indices.length))
    })
    file.create_attribute('library_ids', ['smoke-library'])
    const matrix = file.create_group('matrix')
    const features = matrix.create_group('features')
    matrix.create_dataset({ name: 'barcodes', data: spots.map((s) => s.barcode) })
    features.create_dataset({ name: 'name', data: ['Actb', 'Gad1', 'Gapdh'] })
    features.create_dataset({ name: 'id', data: ['G1', 'G2', 'G3'] })
    features.create_dataset({
      name: 'feature_type',
      data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
    })
    matrix.create_dataset({ name: 'data', data: new Int32Array(data) })
    matrix.create_dataset({ name: 'indices', data: new BigInt64Array(indices) })
    matrix.create_dataset({ name: 'indptr', data: new BigInt64Array(indptr) })
  })
}

// 6. MERSCOPE folders (plain, and with a .vzg named by a manifest).
const merscope = join(repo, 'src/test/fixtures/merscope')
for (const folder of ['merscope-smoke', 'merscope-vzg']) {
  mkdirSync(join(out, folder), { recursive: true })
  for (const name of [
    'cell_by_gene.csv',
    'cell_metadata.csv',
    'cell_boundaries.parquet',
  ]) {
    cpSync(join(merscope, name), join(out, folder, name))
  }
}
cpSync(join(merscope, 'region_0.vzg'), join(out, 'merscope-vzg', 'region_0.vzg'))
writeFileSync(
  join(out, 'merscope-vzg', 'explorer.json'),
  JSON.stringify({ version: 1, platform: 'merscope', files: { vzg: 'region_0.vzg' } }),
)

// 7. Icechunk AnnData and the SpatialData image store.
cpSync(
  join(repo, 'src/test/fixtures/icechunk/anndata.icechunk'),
  join(out, 'anndata.icechunk'),
  { recursive: true },
)
cpSync(
  join(repo, 'src/test/fixtures/spatialdata/image_cells.zarr'),
  join(out, 'image_cells.zarr'),
  { recursive: true },
)

// 8. Imported segmentation: a 64 x 64 slide, a 32-bit label mask and WKT.
function tinyTiff(width, height, bits, value) {
  const bps = bits / 8
  const pixels = Buffer.alloc(width * height * bps)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * bps
      if (bits === 8) pixels.writeUInt8(value(x, y), o)
      else pixels.writeUInt32LE(value(x, y), o)
    }
  const SHORT = 3
  const LONG = 4
  const pixelOffset = 8
  const entries = [
    [256, LONG, width],
    [257, LONG, height],
    [258, SHORT, bits],
    [259, SHORT, 1],
    [262, SHORT, 1],
    [273, LONG, pixelOffset],
    [277, SHORT, 1],
    [278, LONG, height],
    [279, LONG, pixels.byteLength],
  ]
  const ifdOffset = pixelOffset + pixels.byteLength + (pixels.byteLength % 2)
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4)
  ifd.writeUInt16LE(entries.length, 0)
  entries.forEach(([tag, type, v], i) => {
    const o = 2 + i * 12
    ifd.writeUInt16LE(tag, o)
    ifd.writeUInt16LE(type, o + 2)
    ifd.writeUInt32LE(1, o + 4)
    if (type === SHORT) ifd.writeUInt16LE(v, o + 8)
    else ifd.writeUInt32LE(v, o + 8)
  })
  const header = Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0])
  header.writeUInt32LE(ifdOffset, 4)
  return Buffer.concat([
    header,
    pixels,
    Buffer.alloc(ifdOffset - pixelOffset - pixels.byteLength),
    ifd,
  ])
}
mkdirSync(join(out, 'segmentation-smoke'), { recursive: true })
writeFileSync(
  join(out, 'segmentation-smoke/slide.tif'),
  tinyTiff(64, 64, 8, (x, y) => (x + y) % 256),
)
writeFileSync(
  join(out, 'segmentation-smoke/mask.tif'),
  tinyTiff(64, 64, 32, (x, y) =>
    x < 16 && y < 16
      ? 1
      : x >= 40 && y < 16
        ? 70_000
        : x < 16 && y >= 40
          ? 3
          : x >= 40 && y >= 40
            ? 4
            : 0,
  ),
)
writeFileSync(
  join(out, 'segmentation-smoke/cells.csv'),
  'cell_id,geometry\na,"POLYGON ((2 2, 20 2, 20 20, 2 20, 2 2))"\nb,"POLYGON ((30 30, 60 30, 45 60, 30 30))"\n',
)

// 9. The profiling H5AD, over the 64 MiB range-read threshold.
if (withProfile) {
  sizes['profile.h5ad'] = writeH5('profile.h5ad', (file) =>
    writeAnnData(
      file,
      syntheticAnnData({ n: 200_000, g: 500, density: 0.1, seed: 7, prefix: 'p' }),
    ),
  )
}

// The examples index the start screen fetches, from this checkout.
writeFileSync(
  join(out, 'examples-index.json'),
  readFileSync(join(repo, 'examples/index.json')),
)
console.log(JSON.stringify({ out, sizes }, null, 2))
