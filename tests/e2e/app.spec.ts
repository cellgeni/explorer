import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const VISIUM_HD_REFERENCE_URL =
  'https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f'
const H5AD_PBMC3K_REFERENCE_URL = 'https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad'
// CELLxGENE Census copy of GEO GSM6592057 (Visium v1, scanpy layout with
// uns/spatial). Census releases are pinned by date.
const VISIUM_CENSUS_H5AD_URL =
  'https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad'
// 1 x 1 white PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
const ATERA_REFERENCE_URL =
  'https://mp33.cog.sanger.ac.uk/public/test/50170325_WSI_KID_04_region1/50170325_WSI_KID_04_region1'
const ATERA_LOAD_TIMEOUT_MS = 120_000
const XENIUM_LOAD_TIMEOUT_MS = 120_000
const XENIUM_TRANSCRIPT_TIMEOUT_MS = 120_000
const XENIUM_ROI_TIMEOUT_MS = 120_000
const VISIUM_HD_LOAD_TIMEOUT_MS = 90_000
const H5AD_LOAD_TIMEOUT_MS = 60_000
const H5AD_HOSTED_LOAD_TIMEOUT_MS = 120_000
const HOSTED_FIXTURE_PREFLIGHT_TIMEOUT_MS = 10_000

async function loadDefaultXeniumDataset(page: Page) {
  await page.goto('/')

  await expect(page.getByLabel('Dataset or image URL')).toHaveValue(/\/public\/xenium\//)
  await expect(page.getByRole('checkbox', { name: 'Morphology image' })).toBeChecked()

  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expect(page.getByText(/Dataset ready: [1-9][0-9,]* cells/)).toBeVisible({
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()
}

async function loadVisiumHdReferenceDataset(page: Page) {
  await page.goto('/')

  await page.getByLabel('Dataset or image URL').fill(VISIUM_HD_REFERENCE_URL)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const visiumPanel = page.getByRole('region', { name: 'Visium HD dataset' })
  await expect(visiumPanel).toBeVisible({ timeout: VISIUM_HD_LOAD_TIMEOUT_MS })
  await expect(visiumPanel).toContainText('Visium HD')
  await expect(visiumPanel).toContainText('54,504 at 16 µm')
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()

  return visiumPanel
}

async function expectVisiumHdBoundaryLayersOffByDefault(page: Page) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  const layersPanel = page.locator('#hud-panel-layers')
  await expect(layersPanel.getByLabel('Cell boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Cell boundaries')).not.toBeChecked()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).not.toBeChecked()
}

async function routeTinyH5adFixture(page: Page, path = '/h5ad-smoke.h5ad') {
  await routeH5adBytes(page, path, await createTinyH5adFixture())
}

async function routeH5adBytes(page: Page, path: string, bytes: Uint8Array) {
  await page.route(`**${path}`, async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(bytes.byteLength),
      'Content-Type': 'application/octet-stream',
    }

    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 200, headers })
      return
    }

    await route.fulfill({
      status: 200,
      headers,
      body: Buffer.from(bytes),
    })
  })
}

// Space Ranger `outs/` with 36 spots on the Visium lattice at 0.5 µm per
// pixel. Other paths answer 404, so detection falls through to Visium.
async function routeVisiumSpaceRangerFixture(page: Page, folder = '/visium-smoke') {
  const spots = Array.from({ length: 6 }, (_row, row) =>
    Array.from({ length: 6 }, (_col, index) => {
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
  const files: Record<string, { body: Buffer; type: string }> = {
    'spatial/tissue_positions.csv': {
      type: 'text/csv',
      body: Buffer.from(
        [
          'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
          ...spots.map(
            (spot) => `${spot.barcode},1,${spot.row},${spot.col},${spot.y},${spot.x}`,
          ),
        ].join('\n'),
      ),
    },
    'spatial/scalefactors_json.json': {
      type: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          spot_diameter_fullres: 130,
          tissue_hires_scalef: 0.001,
          tissue_lowres_scalef: 0.0005,
        }),
      ),
    },
    'spatial/tissue_hires_image.png': {
      type: 'image/png',
      body: Buffer.from(TINY_PNG_BASE64, 'base64'),
    },
    'filtered_feature_bc_matrix.h5': {
      type: 'application/octet-stream',
      body: Buffer.from(
        await createTinySpaceRangerMatrix(spots.map((spot) => spot.barcode)),
      ),
    },
  }

  await page.route(`**${folder}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(folder.length + 1)
    const file = files[path]

    if (file === undefined) {
      await route.fulfill({ status: 404 })
      return
    }

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Length': String(file.body.byteLength),
      'Content-Type': file.type,
    }
    await route.fulfill(
      route.request().method() === 'HEAD'
        ? { status: 200, headers }
        : { status: 200, headers, body: file.body },
    )
  })
}

// Gad1 is expressed in every other spot.
async function createTinySpaceRangerMatrix(
  barcodes: readonly string[],
): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/playwright-${randomUUID()}.h5`
  const indices: bigint[] = []
  const data: number[] = []
  const indptr: bigint[] = [0n]

  barcodes.forEach((_barcode, index) => {
    indices.push(0n)
    data.push(index + 1)

    if (index % 2 === 0) {
      indices.push(1n)
      data.push(3)
    }

    indptr.push(BigInt(indices.length))
  })

  const file = new h5wasm.File(fileName, 'w')
  file.create_attribute('library_ids', ['smoke-library'])
  const matrix = file.create_group('matrix')
  const features = matrix.create_group('features')
  matrix.create_dataset({ name: 'barcodes', data: [...barcodes] })
  features.create_dataset({ name: 'name', data: ['Actb', 'Gad1', 'Gapdh'] })
  features.create_dataset({ name: 'id', data: ['G1', 'G2', 'G3'] })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })
  matrix.create_dataset({ name: 'data', data: new Int32Array(data) })
  matrix.create_dataset({ name: 'indices', data: new BigInt64Array(indices) })
  matrix.create_dataset({ name: 'indptr', data: new BigInt64Array(indptr) })
  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

async function hostedFixtureAvailable(page: Page, url: string): Promise<boolean> {
  return page.evaluate(
    async ({ targetUrl, timeoutMs }) => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => {
        controller.abort()
      }, timeoutMs)

      try {
        const response = await fetch(targetUrl, {
          method: 'HEAD',
          signal: controller.signal,
        })

        return response.ok
      } catch {
        return false
      } finally {
        window.clearTimeout(timeout)
      }
    },
    { targetUrl: url, timeoutMs: HOSTED_FIXTURE_PREFLIGHT_TIMEOUT_MS },
  )
}

async function createTinyH5adFixture(): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/playwright-${randomUUID()}.h5ad`

  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  obs.create_attribute('_index', 'cell_id')
  obs.create_attribute('column-order', ['cluster', 'n_genes', 'score'])
  obs.create_dataset({
    name: 'cell_id',
    data: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
  })
  obs.create_dataset({ name: 'n_genes', data: new Int32Array([120, 340, 560, 780]) })
  obs.create_dataset({
    name: 'score',
    data: new Float32Array([0.1, 0.5, 0.9, 0.2]),
  })
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
  obsm.create_dataset({
    name: 'X_pca',
    data: new Float32Array([1, 0, 9, 0, 1, 8, -1, 0, 7, 0, -1, 6]),
    shape: [4, 3],
  })

  file.create_dataset({
    name: 'X',
    data: new Float32Array([1, 0, 5, 2, 3, 0, 0, 4, 6, 7, 0, 8]),
    shape: [4, 3],
  })
  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)

  return bytes
}

test('shows the scaffolded viewer shell @smoke', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Hide Controls' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Dataset or image URL')).toHaveValue(/\/public\/xenium\//)
  await expect(page.getByRole('button', { name: 'Load Dataset' })).toBeVisible()
})

test('shows transcript overlay controls in the browser shell @smoke', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByRole('tab', { name: 'Transcripts' }).click()

  await expect(page.getByRole('heading', { name: 'Transcripts' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Show transcripts' })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Detail' })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: 'Feature filter' })).toHaveValue('all')
  await expect(page.getByLabel('Feature search')).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Density color' })).toHaveValue(
    'thermal',
  )
  await expect(page.getByRole('combobox', { name: 'Point color' })).toHaveValue('feature')
})

test('loads a local H5AD fixture with obs tracks and gene expression @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await routeTinyH5adFixture(page)
  await page.goto('/')

  const fixtureUrl = new URL('/h5ad-smoke.h5ad', page.url()).toString()
  await page.getByLabel('Dataset or image URL').fill(fixtureUrl)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expect(page.getByText(/H5AD ready: 4 cells, 3 genes/)).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()

  await expect(page.getByRole('tab', { name: 'Transcripts' })).toHaveCount(0)

  // H5AD loads with the annotation set on None; categorical obs columns are
  // listed as annotation sets and only load on request.
  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await expect(
    genesPanel.getByRole('button', { name: 'Actb', exact: true }),
  ).toBeVisible()
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('transcript-count')

  await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    'Expression all cells: 3 positive cells across 4 slide cells',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )

  await page.getByRole('tab', { name: 'Annotations' }).click()
  const annotationsPanel = page.locator('#hud-panel-annotations')
  await expect(annotationsPanel.getByLabel('Annotation set')).toHaveValue('none')
  await annotationsPanel.getByLabel('Annotation set').selectOption({ label: 'cluster' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  const loadedAnnotations = annotationsPanel.getByLabel('Loaded annotations')
  await expect(loadedAnnotations).toContainText('cluster: A', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(loadedAnnotations).toContainText('cluster: B')

  await page.getByRole('tab', { name: 'Genes' }).click()
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')

  // Numeric obs columns are listed as Metadata tracks; values load on selection.
  await genesPanel.getByLabel('Cell color').selectOption('metadata')
  await expect(genesPanel.getByLabel('Metadata track')).toHaveValue('h5ad:n-genes')
  await expect(genesPanel.getByLabel('Metadata track')).toContainText('score')

  await page.getByRole('tab', { name: 'Cell' }).click()
  const cellPanel = page.locator('#hud-panel-cell')
  await cellPanel.getByRole('button', { name: 'Load Embeddings' }).click()
  await expect(cellPanel.getByLabel('Embedding view')).toContainText('UMAP', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(cellPanel.getByLabel('Embedding view')).toContainText('PCA')
  await expect(
    cellPanel.getByRole('img', { name: 'UMAP embedding, 4 cells' }),
  ).toBeVisible()
})

test('opens a shared H5AD link coloured by a metadata track @smoke', async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)

  await routeTinyH5adFixture(page)
  const sharedState = new URLSearchParams({
    dataset: new URL('/h5ad-smoke.h5ad', baseURL).toString(),
    cellColor: 'metadata',
    cellTrack: 'h5ad:score',
  })
  await page.goto(`/#${sharedState.toString()}`)

  await expect(page.getByText(/H5AD ready: 4 cells, 3 genes/)).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByText(/Metadata track ready: score/)).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByText(/Loading metadata track n_genes/)).toHaveCount(0)

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('metadata')
  await expect(genesPanel.getByLabel('Metadata track')).toHaveValue('h5ad:score')
  await expect(page).toHaveURL(/cellTrack=h5ad%3Ascore/)
})

// Serves src/test/fixtures/icechunk/<repository> (see make_fixtures.py there)
// at the same path, with Range support.
async function routeIcechunkFixture(page: Page, repository: string) {
  await page.route(`**/${repository}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    let bytes: Buffer

    try {
      bytes = await readFile(
        new URL(`../../src/test/fixtures/icechunk${path}`, import.meta.url),
      )
    } catch {
      await route.fulfill({
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      return
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()['range'] ?? '')
    const start = match === null ? 0 : Number(match[1])
    const end = match === null ? bytes.byteLength - 1 : Number(match[2])
    await route.fulfill({
      status: match === null ? 200 : 206,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/octet-stream',
        ...(match === null
          ? {}
          : { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` }),
      },
      body: bytes.subarray(start, end + 1),
    })
  })
}

test('loads AnnData from an Icechunk repository with gene expression @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await routeIcechunkFixture(page, 'anndata.icechunk')
  await page.goto('/')

  const repositoryUrl = new URL('/anndata.icechunk', page.url()).toString()
  await page.getByLabel('Dataset or image URL').fill(repositoryUrl)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expect(page.getByText(/Icechunk AnnData ready: 6 cells, 4 genes/)).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByRole('button', { name: 'Gapdh', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    'Expression all cells: 3 positive cells across 6 slide cells',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
})

// Two Visium sections in one AnnData file (scanpy concat layout): obs
// `library_id`, `in_tissue` with 3 of 10 spots per row off the tissue, and a
// hires image per library. GeneB is expressed only in section-B.
async function createTwoLibraryVisiumH5ad(): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/playwright-${randomUUID()}.h5ad`
  const libraries = ['section-A', 'section-B']
  const rows = libraries.flatMap((_library, library) =>
    Array.from({ length: 100 }, (_spot, spot) => {
      const row = Math.floor(spot / 10)
      const col = (row % 2) + (spot % 10) * 2
      return {
        library,
        row,
        col,
        x: 200 + col * 100,
        y: 200 + row * 100 * Math.sqrt(3),
        inTissue: spot % 10 < 7 ? 1 : 0,
      }
    }),
  )
  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  obs.create_attribute('_index', '_index')
  obs.create_attribute('column-order', [
    'in_tissue',
    'array_row',
    'array_col',
    'library_id',
  ])
  obs.create_dataset({ name: '_index', data: rows.map((_row, index) => `spot-${index}`) })
  obs.create_dataset({
    name: 'in_tissue',
    data: new Int32Array(rows.map((row) => row.inTissue)),
  })
  obs.create_dataset({
    name: 'array_row',
    data: new Int32Array(rows.map((row) => row.row)),
  })
  obs.create_dataset({
    name: 'array_col',
    data: new Int32Array(rows.map((row) => row.col)),
  })
  const library = obs.create_group('library_id')
  library.create_attribute('encoding-type', 'categorical')
  library.create_dataset({ name: 'categories', data: libraries })
  library.create_dataset({
    name: 'codes',
    data: new Int8Array(rows.map((row) => row.library)),
  })
  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', '_index')
  varGroup.create_dataset({ name: '_index', data: ['GeneA', 'GeneB'] })
  file.create_dataset({
    name: 'X',
    data: new Float32Array(
      rows.flatMap((row) => [row.library === 0 ? 2 : 0, row.library]),
    ),
    shape: [rows.length, 2],
  })
  file.create_group('obsm').create_dataset({
    name: 'spatial',
    data: new Float64Array(rows.flatMap((row) => [row.x, row.y])),
    shape: [rows.length, 2],
  })
  const spatial = file.create_group('uns').create_group('spatial')

  for (const id of libraries) {
    const group = spatial.create_group(id)
    const scalefactors = group.create_group('scalefactors')
    scalefactors.create_dataset({ name: 'tissue_hires_scalef', data: 0.1 })
    scalefactors.create_dataset({ name: 'spot_diameter_fullres', data: 130 })
    group.create_group('images').create_dataset({
      name: 'hires',
      data: new Uint8Array(40 * 30 * 3).fill(id === 'section-A' ? 200 : 120),
      shape: [30, 40, 3],
    })
  }

  file.close()
  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

test('switches Visium libraries and off-tissue spots and keeps them in the link @smoke', async ({
  page,
}) => {
  await routeH5adBytes(page, '/two-sections.h5ad', await createTwoLibraryVisiumH5ad())
  await page.goto('/')

  const datasetUrl = new URL('/two-sections.h5ad', page.url()).toString()
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const visiumPanel = page.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toContainText('70 × 55 µm (30 off tissue hidden)', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  const library = visiumPanel.getByTitle('Visium library to show')
  await expect(library).toHaveValue('section-A')
  await expect(page).toHaveURL(/vimg=hires/)
  await expect(page).toHaveURL(/vlib=section-A/)

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByLabel('Gene selection').fill('GeneB')
  await genesPanel.getByRole('button', { name: 'GeneB', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 0 positive cells across 70 slide cells/,
  )

  await page.getByRole('tab', { name: 'Dataset' }).click()
  await library.selectOption('section-B')
  await expect(page.getByText(/Visium library section-B: 70 spots/)).toBeVisible()
  await expect(page).toHaveURL(/vlib=section-B/)
  // The gene selection survives the reload.
  await page.getByRole('tab', { name: 'Genes' }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 70 positive cells across 70 slide cells/,
  )

  await page.getByRole('tab', { name: 'Dataset' }).click()
  await visiumPanel.getByLabel('Show off-tissue spots').check()
  await expect(visiumPanel).toContainText('100 × 55 µm (incl. 30 off tissue)')
  await expect(page).toHaveURL(/voff=1/)
  await visiumPanel.getByTitle('Visium tissue image to show').selectOption('')
  await expect(page).toHaveURL(/vimg=none/)

  // A fresh page opened from the link restores all three choices.
  await page.reload()
  await expect(visiumPanel).toContainText('100 × 55 µm (incl. 30 off tissue)', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(library).toHaveValue('section-B')
  await expect(visiumPanel.getByLabel('Show off-tissue spots')).toBeChecked()
  await expect(visiumPanel.getByTitle('Visium tissue image to show')).toHaveValue('')
})

test('loads a Space Ranger Visium folder as 55 um spots with its tissue image @smoke', async ({
  page,
}) => {
  await routeVisiumSpaceRangerFixture(page)
  await page.goto('/')

  const datasetUrl = new URL('/visium-smoke/', page.url()).toString()
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const visiumPanel = page.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toBeVisible({ timeout: H5AD_LOAD_TIMEOUT_MS })
  await expect(visiumPanel).toContainText('Visium (Space Ranger)')
  await expect(visiumPanel).toContainText('36 × 55 µm')
  await expect(visiumPanel).toContainText('smoke-library')
  await expect(visiumPanel).toContainText('0.5 µm per pixel (array row/column fit')
  await expect(visiumPanel.getByTitle('Visium tissue image to show')).toHaveValue('hires')
  await expect(page.getByText(/Visium ready: 36 spots, 3 genes/)).toBeVisible()
  await expect(page.getByText('Visium hires tissue image ready')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByRole('tab', { name: 'Transcripts' })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByLabel('Gene selection').fill('Gad1')
  await genesPanel.getByRole('button', { name: 'Gad1', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 18 positive cells across 36 slide cells/,
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
})

test('loads a CELLxGENE Visium H5AD with uns/spatial as spots over its H&E @live', async ({
  page,
}) => {
  test.setTimeout(180_000)

  await page.goto('/')

  test.skip(
    !(await hostedFixtureAvailable(page, VISIUM_CENSUS_H5AD_URL)),
    'Census Visium H5AD is unavailable.',
  )

  await page.getByLabel('Dataset or image URL').fill(VISIUM_CENSUS_H5AD_URL)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const visiumPanel = page.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toBeVisible({ timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS })
  await expect(visiumPanel).toContainText('Visium (H5AD)')
  await expect(visiumPanel).toContainText('370 × 55 µm (4,622 off tissue hidden)')
  await expect(visiumPanel).toContainText('GSM6592057_M10')
  await expect(visiumPanel).toContainText('µm per pixel (array row/column fit')
  await expect(page.getByText('Visium hires tissue image ready')).toBeVisible({
    timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS,
  })

  // Symbols come from the categorical var/feature_name, not the Ensembl index.
  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByLabel('Gene selection').fill('MALAT1')
  await genesPanel.getByRole('button', { name: 'MALAT1', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 370 slide cells/,
    { timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS },
  )
})

test('loads the hosted PBMC3K H5AD fixture @live', async ({ page }) => {
  test.setTimeout(180_000)

  await page.goto('/')

  test.skip(
    !(await hostedFixtureAvailable(page, H5AD_PBMC3K_REFERENCE_URL)),
    'Hosted PBMC3K H5AD fixture is unavailable.',
  )

  await page.getByLabel('Dataset or image URL').fill(H5AD_PBMC3K_REFERENCE_URL)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expect(page.getByText(/H5AD ready: 2,638 cells, 1,838 genes/)).toBeVisible({
    timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Transcripts' })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('transcript-count')
  await genesPanel.getByLabel('Gene selection').fill('CD79A')
  await genesPanel.getByRole('button', { name: 'CD79A', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 2,638 slide cells/,
    { timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS },
  )

  await page.getByRole('tab', { name: 'Annotations' }).click()
  const annotationsPanel = page.locator('#hud-panel-annotations')
  await expect(annotationsPanel.getByLabel('Annotation set')).toHaveValue('none')
  await annotationsPanel.getByLabel('Annotation set').selectOption({ label: 'leiden' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  await expect(annotationsPanel.getByLabel('Loaded annotations')).toContainText(
    'leiden: ',
    { timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS },
  )

  await page.getByRole('tab', { name: 'Genes' }).click()
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')

  await genesPanel.getByLabel('Cell color').selectOption('metadata')
  await expect(genesPanel.getByLabel('Metadata track')).toContainText('n_genes')
})

test('loads the hosted Atera kidney run with boundaries, genes, transcripts, and cell types @live', async ({
  page,
}) => {
  test.setTimeout(240_000)

  await page.goto('/')

  test.skip(
    !(await hostedFixtureAvailable(page, `${ATERA_REFERENCE_URL}/experiment.spatial`)),
    'Hosted Atera reference run is unavailable.',
  )

  await page.getByLabel('Dataset or image URL').fill(ATERA_REFERENCE_URL)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expect(page.getByText(/Atera ready: 93,864 cells, 18,050 genes/)).toBeVisible({
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByRole('tab', { name: 'Transcripts' })).toBeVisible()
  await expect(page.getByText('Morphology image ready')).toBeVisible({
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })

  await page.getByRole('tab', { name: 'Layers' }).click()
  const layersPanel = page.locator('#hud-panel-layers')
  const imageChannels = layersPanel.getByLabel('Image channels')
  await expect(imageChannels).toContainText('DAPI')
  await expect(imageChannels).toContainText('ATP1A1/CD45/E-Cadherin')
  await expect(imageChannels).toContainText('alphaSMA/Vimentin')
  await expect(layersPanel.getByLabel('Cell boundaries')).toBeChecked()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).toBeEnabled()

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByLabel('Gene selection').fill('UMOD')
  await genesPanel.getByRole('button', { name: 'UMOD', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 93,864 slide cells/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )

  await page.getByRole('tab', { name: 'Annotations' }).click()
  const annotationsPanel = page.locator('#hud-panel-annotations')
  await annotationsPanel
    .getByLabel('Annotation set')
    .selectOption({ label: 'azimuth_broad' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  await expect(annotationsPanel.getByLabel('Loaded annotations')).toContainText(
    'azimuth_broad: Epithelial cell',
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )

  // With UMOD selected, Atera transcripts are its density from
  // binned_transcripts.zarr.zip; for all features they are cell-summary squares.
  await page.getByRole('tab', { name: 'Transcripts' }).click()
  const transcriptsPanel = page.locator('#hud-panel-transcripts')
  const transcriptSummary = transcriptsPanel.getByLabel('Transcript overlay summary')
  await page.getByRole('checkbox', { name: 'Show transcripts' }).check()
  await expect(transcriptsPanel).toContainText(
    /Showing native 1 selected-feature density squares from binned_transcripts\.zarr\.zip/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )
  await expect(transcriptSummary).toContainText('Per-gene LOD + exact')
  await expect(transcriptSummary).toContainText(/Rendered[1-9][0-9,]* squares/)
  await expect(page.getByRole('checkbox', { name: 'Gene-only calls' })).toBeDisabled()

  await transcriptsPanel.getByLabel('Feature filter').selectOption('all')
  await expect(transcriptsPanel).toContainText('Set Feature filter to Selected genes', {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
  await expect(transcriptSummary).toContainText('Cell summary')

  // Zoomed in on UMOD-rich tubules, the selected-gene estimate fits the
  // exact budget and points come from transcripts.zarr.zip.
  await page.goto(
    `/#xv=1&dataset=${encodeURIComponent(ATERA_REFERENCE_URL)}&genes=UMOD&view=8716%2C-5133%2C0%2C2&tab=transcripts&tx=1&txFilter=selected`,
  )
  await page.reload()
  await expect(transcriptsPanel.locator('.status-chip')).toHaveText(
    /^[1-9][0-9,]* points$/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )
  await expect(transcriptSummary).toContainText(/Rendered[1-9][0-9,]*/)
  await expect(transcriptsPanel.getByLabel('Top transcript groups')).toContainText('UMOD')
})

test('exercises the live Xenium dataset, morphology, transcripts, ROI, and cell panels @live', async ({
  page,
}) => {
  test.setTimeout(300_000)

  await loadDefaultXeniumDataset(page)

  await expect(page.getByText('Morphology image ready')).toBeVisible({
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })

  await page.getByRole('tab', { name: 'Layers' }).click()
  const layersPanel = page.locator('#hud-panel-layers')
  const imageChannels = layersPanel.getByLabel('Image channels')
  await expect(imageChannels).toContainText('DAPI')
  await expect(imageChannels).toContainText('18S')

  await page.getByRole('tab', { name: 'Transcripts' }).click()
  const transcriptsPanel = page.locator('#hud-panel-transcripts')
  await expect(page.getByRole('checkbox', { name: 'Show transcripts' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Detail' }).selectOption('density')
  await page.getByRole('checkbox', { name: 'Show transcripts' }).check()
  await expect(transcriptsPanel).toContainText(
    /Showing native all-transcript density squares from transcripts\.zarr\.zip/,
    { timeout: XENIUM_TRANSCRIPT_TIMEOUT_MS },
  )
  await expect(transcriptsPanel.getByLabel('Transcript overlay summary')).toContainText(
    /Rendered[1-9][0-9,]* squares/,
  )

  await page.getByRole('tab', { name: 'ROI' }).click()
  const roiPanel = page.locator('#hud-panel-roi')
  await expect(roiPanel.getByRole('button', { name: 'Draw Box' })).toBeEnabled({
    timeout: XENIUM_ROI_TIMEOUT_MS,
  })
  await roiPanel.getByRole('button', { name: 'Draw Box' }).click()
  await expect(roiPanel.getByRole('button', { name: 'Drawing Box' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const viewer = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()

  if (viewerBox === null) {
    return
  }

  await page.mouse.move(
    viewerBox.x + viewerBox.width * 0.48,
    viewerBox.y + viewerBox.height * 0.48,
  )
  await page.mouse.down()
  await page.mouse.move(
    viewerBox.x + viewerBox.width * 0.52,
    viewerBox.y + viewerBox.height * 0.52,
    {
      steps: 10,
    },
  )
  await page.mouse.up()

  const roiSummary = roiPanel.getByLabel('ROI summary')
  await expect(roiSummary).toContainText(/Cells\s*[1-9]/, {
    timeout: XENIUM_ROI_TIMEOUT_MS,
  })
  await expect(roiPanel.getByRole('button', { name: 'Export Cells' })).toBeEnabled()
  await expect(roiPanel.getByRole('button', { name: 'Export Transcripts' })).toBeEnabled()

  const downloadPromise = page.waitForEvent('download')
  await roiPanel.getByRole('button', { name: 'Export Cells' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('roi-1-cells.csv')

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  if (downloadPath !== null) {
    await expect(readFile(downloadPath, 'utf8')).resolves.toContain(
      'cell_id,x_centroid,y_centroid,transcript_counts,cell_area',
    )
  }

  await page.getByRole('tab', { name: 'Cell' }).click()
  const cellPanel = page.locator('#hud-panel-cell')
  await expect(page.getByRole('heading', { name: 'Cell Info' })).toBeVisible()
  await expect(cellPanel).toContainText('No cell selected')
})

test('loads the Visium HD reference dataset with tissue image and 16 um bins @live', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await loadVisiumHdReferenceDataset(page)
  await expectVisiumHdBoundaryLayersOffByDefault(page)
})

test('exercises Visium HD tiers, Feature Slice genes, ROI export, and advanced controls @live', async ({
  page,
}) => {
  test.setTimeout(600_000)

  const visiumPanel = await loadVisiumHdReferenceDataset(page)

  await expect(visiumPanel.getByRole('button', { name: '16 µm' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await visiumPanel.getByRole('button', { name: '8 µm' }).click()
  await expect(visiumPanel).toContainText('215,320 at 8 µm', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
  await expect(visiumPanel.getByRole('button', { name: '8 µm' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await visiumPanel.getByRole('button', { name: '16 µm' }).click()
  await expect(visiumPanel).toContainText('54,504 at 16 µm', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })

  await expect(visiumPanel.getByRole('button', { name: '2 µm' })).toBeEnabled()
  await expect(visiumPanel.getByRole('button', { name: '2 µm' })).toHaveAttribute(
    'title',
    '2 µm bins',
  )

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByRole('button', { name: 'A2M', exact: true }).click()
  await expect(genesPanel.getByTitle('Remove A2M')).toBeVisible()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 54,504 slide cells/,
    { timeout: 60_000 },
  )

  await page.getByRole('tab', { name: 'Magic Lens' }).click()
  const magicLensPanel = page.locator('#hud-panel-magic-lens')
  await expect(magicLensPanel.getByRole('spinbutton', { name: 'Min QV' })).toHaveCount(0)
  await magicLensPanel.getByRole('button', { name: 'Viewport' }).click()
  await expect(magicLensPanel.getByRole('button', { name: 'Scan Lens' })).toBeEnabled()
  await magicLensPanel.getByRole('button', { name: 'Scan Lens' }).click()
  const magicLensResults = magicLensPanel.getByLabel('Magic lens results')
  await expect(magicLensResults).toContainText('UMIs', { timeout: 60_000 })
  await expect(magicLensResults).toContainText('Bins')
  await expect(magicLensPanel.getByLabel('Magic lens gene distribution')).toContainText(
    'A2M',
  )

  await page.getByRole('tab', { name: 'Cell' }).click()
  const cellPanel = page.locator('#hud-panel-cell')
  await expect(page.getByRole('heading', { name: 'Bin Info' })).toBeVisible()
  await expect(cellPanel).toContainText('No bin selected')

  await page.getByRole('tab', { name: 'ROI' }).click()
  const roiPanel = page.locator('#hud-panel-roi')
  await expect(roiPanel.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
  await expect(roiPanel.getByRole('button', { name: 'Draw Lasso' })).toBeEnabled()
  await roiPanel.getByRole('button', { name: 'Draw Box' }).click()
  await expect(roiPanel.getByRole('button', { name: 'Drawing Box' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const viewer = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()

  if (viewerBox === null) {
    return
  }

  await page.mouse.move(
    viewerBox.x + viewerBox.width * 0.45,
    viewerBox.y + viewerBox.height * 0.45,
  )
  await page.mouse.down()
  await page.mouse.move(
    viewerBox.x + viewerBox.width * 0.56,
    viewerBox.y + viewerBox.height * 0.56,
    {
      steps: 10,
    },
  )
  await page.mouse.up()

  const roiSummary = roiPanel.getByLabel('ROI summary')
  await expect(roiSummary).toContainText('Bins')
  await expect(roiSummary).toContainText('0')
  await expect(roiPanel.getByRole('button', { name: 'Export Barcodes' })).toBeEnabled()

  const downloadPromise = page.waitForEvent('download')
  await roiPanel.getByRole('button', { name: 'Export Barcodes' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('roi-1-barcodes.csv')

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  if (downloadPath !== null) {
    await expect(readFile(downloadPath, 'utf8')).resolves.toContain(
      'barcode,bin_size_um,array_row,array_col,fullres_row,fullres_col,in_tissue,x_centroid,y_centroid,expression_count,expression_genes',
    )
  }
})
