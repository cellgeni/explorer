import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  collectAxeFindings,
  expectAxeFindingsMatchBaseline,
  type AxeFindings,
} from './axe'
import { expectLogEntry, openControls } from './controls'
import { failExamplesIndex, routeLocalExamplesIndex } from './examples'

const XENIUM_DEMO_URL =
  'https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328'
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
// A cold nucleus query reads about 15 MB of nucleus_boundaries.parquet.
const XENIUM_BOUNDARY_TIMEOUT_MS = 120_000
// Brain tissue in the Xenium demo at zoom 2.5: about 600 cells in view at
// 1280 × 720, and about 4,300 nuclei in the padded boundary request.
const XENIUM_TISSUE_VIEW = '1303,-1920,0,2.5'
const VISIUM_HD_LOAD_TIMEOUT_MS = 90_000
const VISIUM_HD_BIN_PROFILE_TIMEOUT_MS = 120_000
// The cell assignment reads the footer of barcode_mappings.parquet (704 KB)
// and the few row groups that can hold the bin, about 300 KB for 16 µm.
const VISIUM_HD_BIN_ASSIGNMENT_TIMEOUT_MS = 60_000
// Each boundary request streams the whole cell (68 MB) and nucleus (44 MB)
// segmentation GeoJSON and keeps the polygons around the view.
const VISIUM_HD_BOUNDARY_TIMEOUT_MS = 180_000
// 3.4 million 2 µm bins from the 2 µm matrix barcodes: about 15 s and 2 GB
// of JS heap locally.
const VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS = 300_000
// The right-hand tissue section of the Visium HD reference at one screen
// pixel per micrometre: about 2,400 16 µm bins in view, under the 50,000-bin
// boundary limit, with a bin at the centre.
const VISIUM_HD_TISSUE_VIEW = '5647,-4817.5,0,0'
const H5AD_LOAD_TIMEOUT_MS = 60_000
const H5AD_HOSTED_LOAD_TIMEOUT_MS = 120_000
const HOSTED_FIXTURE_PREFLIGHT_TIMEOUT_MS = 10_000

// The start screen's example gallery is served from this checkout.
test.beforeEach(async ({ page }) => {
  await routeLocalExamplesIndex(page)
})

async function loadDefaultXeniumDataset(page: Page) {
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(XENIUM_DEMO_URL)
  await openControls(page, 'open-dataset')
  await expect(page.getByRole('checkbox', { name: 'Morphology image' })).toBeChecked()

  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /Dataset ready: [1-9][0-9,]* cells/, {
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()
}

async function loadVisiumHdReferenceDataset(page: Page) {
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(VISIUM_HD_REFERENCE_URL)
  await openControls(page, 'open-dataset')
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
  const layersPanel = await openControls(page, 'cell-appearance')
  await expect(layersPanel.getByLabel('Cell boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Cell boundaries')).not.toBeChecked()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).not.toBeChecked()
}

// Opens the Visium HD reference run from a link at VISIUM_HD_TISSUE_VIEW, with
// 16 µm bins (the link does not keep the bin size).
async function openVisiumHdReferenceTissueLink(page: Page) {
  await page.goto(
    `/#xv=2&dataset=${encodeURIComponent(VISIUM_HD_REFERENCE_URL)}&view=${encodeURIComponent(VISIUM_HD_TISSUE_VIEW)}`,
  )

  const visiumPanel = page.getByRole('region', { name: 'Visium HD dataset' })
  await expect(visiumPanel).toContainText('54,504 at 16 µm', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()

  return visiumPanel
}

// Enter opens the bin under the viewer's crosshair (15.5-D). A mouse click
// does not select bins under headless Chromium's software WebGL, though it
// does with a GPU.
async function selectVisiumHdBinAtCentre(page: Page) {
  await page.getByRole('img', { name: 'Spatial viewer canvas area' }).focus()
  await page.keyboard.press('Enter')

  const binCard = page.getByRole('region', { name: 'Bin', exact: true })
  await expect(binCard).toContainText('Selected bin', { timeout: 30_000 })

  return binCard
}

// The barcode, size, tissue flag, array position and image position the Bin
// card lists for a Space Ranger bin barcode such as s_016um_00209_00095-1.
async function expectVisiumHdBinDetails(binCard: Locator, barcode: string) {
  const match = /^s_0*(\d+)um_(\d{5})_(\d{5})-1$/.exec(barcode)
  expect(match).not.toBeNull()

  const [, binSize = '', row = '', col = ''] = match ?? []
  await expect(binCard).toContainText(`Barcode${barcode}`)
  await expect(binCard).toContainText(`Bin Size${binSize} µm`)
  await expect(binCard).toContainText('TissueIn tissue')
  await expect(binCard).toContainText(
    `Arrayrow ${Number(row).toLocaleString('en-US')}, col ${Number(col).toLocaleString('en-US')}`,
  )
  await expect(binCard).toContainText(/Image Pxrow [0-9][0-9,.]*, col [0-9][0-9,.]*/)
}

// The Bin card loads the bin's whole expression profile on its own.
async function expectVisiumHdBinProfile(binCard: Locator) {
  await expect(binCard).toContainText(/Bin GEX profile[1-9][0-9,]* counts/, {
    timeout: VISIUM_HD_BIN_PROFILE_TIMEOUT_MS,
  })

  const topGenes = binCard.getByRole('list', { name: 'Top selected bin genes' })
  await expect(topGenes.getByRole('listitem').first()).toContainText(
    /^[A-Za-z0-9.-]+[1-9][0-9,]*[0-9.]+% total$/,
  )
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

  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible()
  const start = await openControls(page, 'open-dataset')
  await expect(start).toHaveAccessibleName('Open a dataset')
  await expect(start.getByLabel('Dataset or image URL')).toHaveValue('')
  await expect(start.getByRole('button', { name: 'Load Dataset' })).toBeVisible()
})

test('lists the examples on the start screen, and opens one in place @smoke', async ({
  page,
}) => {
  const { examples } = JSON.parse(
    await readFile(new URL('../../examples/index.json', import.meta.url), 'utf8'),
  ) as {
    readonly examples: readonly { readonly name: string; readonly manifestUrl: string }[]
  }
  const first = examples[0]
  if (first === undefined) throw new Error('examples/index.json lists no examples')
  await routeTinyH5adFixture(page)
  await page.goto('/')
  // The first example's manifest is answered here and opens the tiny H5AD
  // fixture, so nothing leaves the machine.
  const fixtureUrl = new URL('/h5ad-smoke.h5ad', page.url()).href
  await page.route(first.manifestUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        version: 1,
        platform: 'h5ad',
        name: first.name,
        files: { h5ad: fixtureUrl },
      }),
    }),
  )

  const gallery = page
    .getByRole('region', { name: 'Open a dataset' })
    .getByRole('list', { name: 'Examples' })
  await expect(gallery.getByRole('listitem')).toHaveCount(examples.length)
  const link = gallery.getByRole('link', { name: first.name })
  await expect(link).toHaveAttribute(
    'href',
    `/?dataset=${encodeURIComponent(first.manifestUrl)}`,
  )

  // A plain click opens it in place, without reloading the page.
  await page.evaluate(() => {
    document.documentElement.dataset.startScreenTest = 'same page'
  })
  await link.click()
  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.locator('html')).toHaveAttribute(
    'data-start-screen-test',
    'same page',
  )
  await expect(page.getByRole('region', { name: 'Open a dataset' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Close Dataset info' }).click()
  const menu = await openControls(page, 'open-dataset')
  await expect(
    menu.getByRole('list', { name: 'Recent datasets' }).getByRole('link', {
      name: first.name,
    }),
  ).toBeVisible()
})

test('offers the demo when the examples cannot be loaded @smoke', async ({ page }) => {
  await failExamplesIndex(page)
  await page.goto('/')

  const start = page.getByRole('region', { name: 'Open a dataset' })
  await expect(start).toContainText("Examples couldn't be loaded from GitHub.")
  await expect(start.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(
    start
      .getByRole('list', { name: 'Demo dataset' })
      .getByRole('link', { name: 'Human brain (Xenium 5K demo)' }),
  ).toHaveAttribute('href', `/?dataset=${encodeURIComponent(XENIUM_DEMO_URL)}`)
})

test('skips the start screen for a link that names a dataset @smoke', async ({
  page,
}) => {
  await routeTinyH5adFixture(page)
  await page.goto('/?dataset=%2Fh5ad-smoke.h5ad')

  await expect(page.getByRole('region', { name: 'Open a dataset' })).toHaveCount(0)
})

test('has no accessibility violations beyond the axe baseline @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const findings: AxeFindings = new Map()

  // Every layer section, the info drawer, the dataset menu, Help, Settings
  // and the Embedding panel, empty and with data.
  async function checkEachPlace(state: string) {
    const layers = page.getByRole('complementary', { name: 'Layers' })
    const sections = layers.getByRole('heading', { level: 3 }).getByRole('button')

    for (let index = 0; index < (await sections.count()); index += 1) {
      const section = sections.nth(index)
      if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
    }
    await collectAxeFindings(page, `${state}, layer sections`, findings)

    await openControls(page, 'diagnostics')
    await collectAxeFindings(page, `${state}, info drawer`, findings)
    await page.getByRole('button', { name: 'Close Dataset info' }).click()

    for (const title of ['Open dataset', 'Help', 'Settings']) {
      await page.getByTitle(title, { exact: true }).click()
      await collectAxeFindings(page, `${state}, ${title}`, findings)
      await page.keyboard.press('Escape')
    }

    await openControls(page, 'embedding')
    await collectAxeFindings(page, `${state}, embedding`, findings)
    await page.getByRole('button', { name: 'Close embedding' }).click()
  }

  await routeTinyH5adFixture(page)
  await page.goto('/')
  await checkEachPlace('empty viewer')

  await openControls(page, 'open-dataset')
  const fixtureUrl = new URL('/h5ad-smoke.h5ad', page.url()).toString()
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(fixtureUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText('Expression', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await checkEachPlace('H5AD fixture with a gene selected')

  expectAxeFindingsMatchBaseline(findings)
})

// Presses Tab until the target has focus, as a keyboard user would, and
// fails if it is not in the tab order.
async function tabTo(page: Page, target: Locator, limit = 150): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${target.toString()}`)
}

// Review tasks 1-5 (UNIFIED_PLAN.md, 15.5-D) with the keyboard alone: open a
// dataset, colour cells by a gene, show clusters and hide one, open a cell,
// and select a region and read its genes.
test('runs the first five review tasks with the keyboard alone @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await routeTinyH5adFixture(page)
  await page.goto('/')

  // 1. Open a dataset from the start screen.
  const start = page.getByRole('region', { name: 'Open a dataset' })
  await tabTo(page, start.getByLabel('Dataset or image URL'))
  await page.keyboard.type(new URL('/h5ad-smoke.h5ad', page.url()).href)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: '4 cells' })).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  // 2. Colour cells by a gene, which the legend then names.
  const cells = page
    .getByRole('complementary', { name: 'Layers' })
    .getByRole('region', { name: /^Cells/ })
  await tabTo(page, cells.getByLabel('Gene selection'))
  await page.keyboard.type('Gad')
  await tabTo(page, cells.getByRole('button', { name: 'Gad1', exact: true }))
  await page.keyboard.press('Enter')
  const legend = page.getByRole('region', { name: 'Legend' })
  await expect(legend).toContainText('Gad1', { timeout: H5AD_LOAD_TIMEOUT_MS })

  // 3. Show the clusters, then hide one from the legend.
  await tabTo(page, cells.getByLabel('Annotation set'))
  await page.keyboard.type('cluster')
  await tabTo(page, cells.getByRole('button', { name: 'Load Annotations' }))
  await page.keyboard.press('Enter')
  const clusterA = legend.getByRole('checkbox', { name: /^A, / })
  await expect(clusterA).toBeChecked({ timeout: H5AD_LOAD_TIMEOUT_MS })
  await tabTo(page, clusterA)
  await page.keyboard.press('Space')
  await expect(clusterA).not.toBeChecked()

  // 4. Open a cell: Enter opens the one at the centre of the view. Zoom out
  // until one is there.
  const canvas = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  await tabTo(page, canvas)
  const cellCard = page.getByRole('region', { name: 'Cell', exact: true })
  for (let step = 0; step < 8 && !(await cellCard.isVisible()); step += 1) {
    await page.keyboard.press('Enter')
    if (!(await cellCard.isVisible())) await page.keyboard.press('-')
  }
  await expect(cellCard).toContainText('n_genes')

  // 5. Select the view with the Box tool and read its genes.
  await expect(canvas).toBeFocused()
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Box selection' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Enter')
  const selection = page.getByRole('region', { name: 'ROI 1' })
  await expect(selection.getByLabel('ROI gene distribution')).toContainText('Gad1', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByRole('button', { name: 'Pan' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // The cards, too, have nothing for axe to find.
  const findings: AxeFindings = new Map()
  await collectAxeFindings(page, 'keyboard tasks, Cell and Selection cards', findings)
  expect([...findings.keys()]).toEqual([])
})

test('shows transcript overlay controls in the browser shell @smoke', async ({
  page,
}) => {
  await page.goto('/')

  await openControls(page, 'transcripts')

  await expect(page.getByRole('heading', { name: /^Transcripts/ })).toBeVisible()
  await expect(
    page.getByRole('checkbox', { name: 'Show transcripts', exact: true }),
  ).toBeDisabled()
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
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(fixtureUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()

  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts/ }),
  ).toHaveCount(0)

  // H5AD loads with the annotation set on None; categorical obs columns are
  // listed as annotation sets and only load on request.
  const genesPanel = await openControls(page, 'genes')
  await expect(
    genesPanel.getByRole('button', { name: 'Actb', exact: true }),
  ).toBeVisible()
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('transcript-count')

  await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    'Expression all cells: 3 positive cells across 4 slide cells',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )

  const annotationsPanel = await openControls(page, 'clusters')
  await expect(annotationsPanel.getByLabel('Annotation set')).toHaveValue('none')
  await annotationsPanel.getByLabel('Annotation set').selectOption({ label: 'cluster' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  // One list per set: the set is a heading and labels drop its prefix.
  const loadedAnnotations = annotationsPanel.getByRole('region', {
    name: 'cluster labels',
  })
  await expect(loadedAnnotations).toContainText('A', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(loadedAnnotations).toContainText('B')

  await openControls(page, 'color-by')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')

  // Numeric obs columns are listed as Metadata tracks; values load on selection.
  await genesPanel.getByLabel('Cell color').selectOption('metadata')
  await expect(genesPanel.getByLabel('Metadata track', { exact: true })).toHaveValue(
    'h5ad:n-genes',
  )
  await expect(genesPanel.getByLabel('Metadata track', { exact: true })).toContainText(
    'score',
  )

  const cellPanel = await openControls(page, 'embedding')
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

  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(page, /Metadata track ready: score/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page.getByText(/Loading metadata track n_genes/)).toHaveCount(0)

  const genesPanel = await openControls(page, 'color-by')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('metadata')
  await expect(genesPanel.getByLabel('Metadata track', { exact: true })).toHaveValue(
    'h5ad:score',
  )
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
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(repositoryUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /Icechunk AnnData ready: 6 cells, 4 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const genesPanel = await openControls(page, 'genes')
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
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  // The library is a view option in the info drawer; off-tissue spots and the
  // tissue image are in the Spots and Image sections.
  const info = await openControls(page, 'view-options')
  const visiumPanel = info.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toContainText('70 × 55 µm (30 off tissue hidden)', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  const library = visiumPanel.getByTitle('Visium library to show')
  await expect(library).toHaveValue('section-A')
  await expect(page).toHaveURL(/vimg=hires/)
  await expect(page).toHaveURL(/vlib=section-A/)

  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByLabel('Gene selection').fill('GeneB')
  await genesPanel.getByRole('button', { name: 'GeneB', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 0 positive cells across 70 slide cells/,
  )

  // The library switch reloads from the link, which follows within 160 ms.
  await expect(page).toHaveURL(/genes=GeneB/)
  await openControls(page, 'view-options')
  await library.selectOption('section-B')
  await expectLogEntry(page, /Visium library section-B: 70 spots/)
  await expect(page).toHaveURL(/vlib=section-B/)
  // The gene selection survives the reload.
  await openControls(page, 'genes')
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 70 positive cells across 70 slide cells/,
  )

  const spots = await openControls(page, 'spot-options')
  await spots.getByLabel('Show off-tissue spots', { exact: true }).check()
  await expect(visiumPanel).toContainText('100 × 55 µm (incl. 30 off tissue)')
  await expect(page).toHaveURL(/voff=1/)
  const image = await openControls(page, 'tissue-image')
  await image.getByTitle('Visium tissue image to show').selectOption('')
  await expect(page).toHaveURL(/vimg=none/)

  // A fresh page opened from the link restores all three choices, and the
  // open drawer and sections (panel=).
  await page.reload()
  await expect(visiumPanel).toContainText('100 × 55 µm (incl. 30 off tissue)', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(library).toHaveValue('section-B')
  await expect(spots.getByLabel('Show off-tissue spots', { exact: true })).toBeChecked()
  await expect(image.getByTitle('Visium tissue image to show')).toHaveValue('')
})

test('loads a Space Ranger Visium folder as 55 um spots with its tissue image @smoke', async ({
  page,
}) => {
  await routeVisiumSpaceRangerFixture(page)
  await page.goto('/')

  const datasetUrl = new URL('/visium-smoke/', page.url()).toString()
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const info = await openControls(page, 'view-options')
  const visiumPanel = info.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toBeVisible({ timeout: H5AD_LOAD_TIMEOUT_MS })
  await expect(visiumPanel).toContainText('Visium (Space Ranger)')
  await expect(visiumPanel).toContainText('36 × 55 µm')
  await expect(visiumPanel).toContainText('smoke-library')
  await expect(visiumPanel).toContainText('0.5 µm per pixel (array row/column fit')
  const image = await openControls(page, 'tissue-image')
  await expect(image.getByTitle('Visium tissue image to show')).toHaveValue('hires')
  await expectLogEntry(page, /Visium ready: 36 spots, 3 genes/)
  await expectLogEntry(page, /Visium hires tissue image ready/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts/ }),
  ).toHaveCount(0)

  const genesPanel = await openControls(page, 'genes')
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

  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(VISIUM_CENSUS_H5AD_URL)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  const info = await openControls(page, 'view-options')
  const visiumPanel = info.getByRole('region', { name: 'Visium dataset' })
  await expect(visiumPanel).toBeVisible({ timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS })
  await expect(visiumPanel).toContainText('Visium (H5AD)')
  await expect(visiumPanel).toContainText('370 × 55 µm (4,622 off tissue hidden)')
  await expect(visiumPanel).toContainText('GSM6592057_M10')
  await expect(visiumPanel).toContainText('µm per pixel (array row/column fit')
  await expectLogEntry(page, /Visium hires tissue image ready/, {
    timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS,
  })

  // Symbols come from the categorical var/feature_name, not the Ensembl index.
  const genesPanel = await openControls(page, 'genes')
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

  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(H5AD_PBMC3K_REFERENCE_URL)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /H5AD ready: 2,638 cells, 1,838 genes/, {
    timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts/ }),
  ).toHaveCount(0)

  const genesPanel = await openControls(page, 'color-by')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('transcript-count')
  await openControls(page, 'genes')
  await genesPanel.getByLabel('Gene selection').fill('CD79A')
  await genesPanel.getByRole('button', { name: 'CD79A', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 2,638 slide cells/,
    { timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS },
  )

  const annotationsPanel = await openControls(page, 'clusters')
  await expect(annotationsPanel.getByLabel('Annotation set')).toHaveValue('none')
  await annotationsPanel.getByLabel('Annotation set').selectOption({ label: 'leiden' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  await expect(
    annotationsPanel.getByRole('region', { name: 'leiden labels' }),
  ).toBeVisible({ timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS })

  await openControls(page, 'color-by')
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')

  await genesPanel.getByLabel('Cell color').selectOption('metadata')
  await expect(genesPanel.getByLabel('Metadata track', { exact: true })).toContainText(
    'n_genes',
  )
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

  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(ATERA_REFERENCE_URL)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /Atera ready: 93,864 cells, 18,050 genes/, {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts/ }),
  ).toBeVisible()
  await expectLogEntry(page, /Morphology image ready/, {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })

  const layersPanel = await openControls(page, 'image')
  const imageChannels = layersPanel.getByLabel('Image channels')
  await expect(imageChannels).toContainText('DAPI')
  await expect(imageChannels).toContainText('ATP1A1/CD45/E-Cadherin')
  await expect(imageChannels).toContainText('alphaSMA/Vimentin')
  const cellsPanel = await openControls(page, 'cell-appearance')
  await expect(cellsPanel.getByLabel('Cell boundaries', { exact: true })).toBeChecked()
  await expect(cellsPanel.getByLabel('Nucleus boundaries', { exact: true })).toBeEnabled()

  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByLabel('Gene selection').fill('UMOD')
  await genesPanel.getByRole('button', { name: 'UMOD', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 93,864 slide cells/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )

  const annotationsPanel = await openControls(page, 'clusters')
  await annotationsPanel
    .getByLabel('Annotation set')
    .selectOption({ label: 'azimuth_broad' })
  await annotationsPanel.getByRole('button', { name: 'Load Annotations' }).click()
  await expect(
    annotationsPanel.getByRole('region', { name: 'azimuth_broad labels' }),
  ).toContainText('Epithelial cell', { timeout: ATERA_LOAD_TIMEOUT_MS })

  // With UMOD selected, Atera transcripts are its density from
  // binned_transcripts.zarr.zip; for all features they are cell-summary squares.
  const transcriptsPanel = await openControls(page, 'transcripts')
  const transcriptSummary = transcriptsPanel.getByLabel('Transcript overlay summary')
  await page.getByRole('checkbox', { name: 'Show transcripts', exact: true }).check()
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
  // exact budget and points come from transcripts.zarr.zip. Leaving the page
  // first makes this a fresh load; a hash-only goto lets the app's pending
  // link write replace the new hash before a reload reads it.
  await page.goto('about:blank')
  await page.goto(
    `/#xv=1&dataset=${encodeURIComponent(ATERA_REFERENCE_URL)}&genes=UMOD&view=8716%2C-5133%2C0%2C2&tab=transcripts&tx=1&txFilter=selected`,
  )
  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts.*UMOD · points/ }),
  ).toBeVisible({ timeout: ATERA_LOAD_TIMEOUT_MS })
  await expect(transcriptSummary).toContainText(/Rendered[1-9][0-9,]*/)
  await expect(transcriptsPanel.getByLabel('Top transcript groups')).toContainText('UMOD')
})

test('exercises the live Xenium dataset, morphology, transcripts, ROI, and cell panels @live', async ({
  page,
}) => {
  test.setTimeout(300_000)

  await loadDefaultXeniumDataset(page)

  await expectLogEntry(page, /Morphology image ready/, {
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })

  const layersPanel = await openControls(page, 'image')
  const imageChannels = layersPanel.getByLabel('Image channels')
  await expect(imageChannels).toContainText('DAPI')
  await expect(imageChannels).toContainText('18S')

  const transcriptsPanel = await openControls(page, 'transcripts')
  await expect(
    page.getByRole('checkbox', { name: 'Show transcripts', exact: true }),
  ).toBeEnabled()
  await page.getByRole('combobox', { name: 'Detail' }).selectOption('density')
  await page.getByRole('checkbox', { name: 'Show transcripts', exact: true }).check()
  await expect(transcriptsPanel).toContainText(
    /Showing native all-transcript density squares from transcripts\.zarr\.zip/,
    { timeout: XENIUM_TRANSCRIPT_TIMEOUT_MS },
  )
  await expect(transcriptsPanel.getByLabel('Transcript overlay summary')).toContainText(
    /Rendered[1-9][0-9,]* squares/,
  )

  const boxTool = page.getByRole('button', { name: 'Box selection' })
  await expect(boxTool).toHaveAttribute('aria-disabled', 'false', {
    timeout: XENIUM_ROI_TIMEOUT_MS,
  })
  await boxTool.click()
  await expect(boxTool).toHaveAttribute('aria-pressed', 'true')

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

  const selectionCard = page.getByRole('region', { name: 'ROI 1' })
  await expect(selectionCard).toContainText(/[1-9][0-9,]* cells? · /, {
    timeout: XENIUM_ROI_TIMEOUT_MS,
  })
  await selectionCard.getByRole('tab', { name: 'Cells' }).click()
  await expect(selectionCard.getByLabel('ROI summary')).toContainText(/Cells\s*[1-9]/)
  await expect(selectionCard.getByRole('button', { name: 'Export Cells' })).toBeEnabled()
  await expect(
    selectionCard.getByRole('button', { name: 'Export Transcripts' }),
  ).toBeEnabled()

  const downloadPromise = page.waitForEvent('download')
  await selectionCard.getByRole('button', { name: 'Export Cells' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('roi-1-cells.csv')

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  if (downloadPath !== null) {
    await expect(readFile(downloadPath, 'utf8')).resolves.toContain(
      'cell_id,x_centroid,y_centroid,transcript_counts,cell_area',
    )
  }

  // The Cell card shows only once a cell is clicked.
  await expect(page.getByRole('region', { name: 'Cell', exact: true })).toHaveCount(0)
})

test('draws Xenium nucleus boundaries without reading cell outlines @live', async ({
  page,
}) => {
  test.setTimeout(300_000)

  await page.goto(
    `/#xv=2&dataset=${encodeURIComponent(XENIUM_DEMO_URL)}&view=${encodeURIComponent(XENIUM_TISSUE_VIEW)}&cellBounds=0&nucleusBounds=1`,
  )
  const cellsPanel = await openControls(page, 'cell-appearance')
  await expect(cellsPanel.getByLabel('Cell boundaries')).not.toBeChecked()
  await expect(cellsPanel.getByLabel('Nucleus boundaries')).toBeChecked()

  // With cell outlines hidden only nucleus_boundaries.parquet is queried.
  await expectLogEntry(
    page,
    /Boundaries ready: 0 cells in [0-9] ms, [1-9][0-9,]* nuclei in [0-9,]+ ms/,
    { timeout: XENIUM_BOUNDARY_TIMEOUT_MS },
  )
  const log = page.getByRole('region', { name: 'Activity log' })
  await expect(log.getByText('Boundary load failed')).toHaveCount(0)
  await expect(page.locator('.viewport-message-error')).toHaveCount(0)
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

  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByRole('button', { name: 'A2M', exact: true }).click()
  await expect(genesPanel.getByTitle('Remove A2M')).toBeVisible()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: [1-9][0-9,]* positive cells across 54,504 slide cells/,
    { timeout: 60_000 },
  )

  // Summarise View scans the whole view into the Magic Lens card (D14).
  const magicLensPopover = await openControls(page, 'magic-lens')
  await expect(magicLensPopover.getByRole('spinbutton', { name: 'Min QV' })).toHaveCount(
    0,
  )
  await expect(
    magicLensPopover.getByRole('button', { name: 'Summarise View' }),
  ).toBeEnabled()
  await magicLensPopover.getByRole('button', { name: 'Summarise View' }).click()
  const magicLensCard = page.getByRole('region', { name: 'Magic Lens' })
  const magicLensResults = magicLensCard.getByLabel('Magic lens results')
  await expect(magicLensResults).toContainText('UMIs', { timeout: 60_000 })
  await expect(magicLensResults).toContainText('Bins')
  await expect(magicLensCard.getByLabel('Magic lens gene distribution')).toContainText(
    'A2M',
  )
  await magicLensCard.getByRole('button', { name: 'Clear Magic Lens' }).click()

  // The Bin card shows only once a bin is clicked.
  await expect(page.getByRole('region', { name: 'Bin', exact: true })).toHaveCount(0)

  const boxTool = page.getByRole('button', { name: 'Box selection' })
  await expect(boxTool).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByRole('button', { name: 'Lasso selection' })).toHaveAttribute(
    'aria-disabled',
    'false',
  )
  await boxTool.click()
  await expect(boxTool).toHaveAttribute('aria-pressed', 'true')

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

  const selectionCard = page.getByRole('region', { name: 'ROI 1' })
  await selectionCard.getByRole('tab', { name: 'Bins' }).click()
  const roiSummary = selectionCard.getByLabel('ROI summary')
  await expect(roiSummary).toContainText('Bins')
  await expect(roiSummary).toContainText('0')
  await expect(
    selectionCard.getByRole('button', { name: 'Export Barcodes' }),
  ).toBeEnabled()

  const downloadPromise = page.waitForEvent('download')
  await selectionCard.getByRole('button', { name: 'Export Barcodes' }).click()
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

test('opens a Visium HD bin card from the keyboard and again from its link @live', async ({
  page,
}) => {
  test.setTimeout(300_000)

  await openVisiumHdReferenceTissueLink(page)
  const binCard = await selectVisiumHdBinAtCentre(page)
  const barcode = await binCard.getByText(/^s_016um_\d{5}_\d{5}-1$/).innerText()

  await expectVisiumHdBinDetails(binCard, barcode)
  await expectVisiumHdBinProfile(binCard)
  await expect(page).toHaveURL(new RegExp(`&card=bin%3A${barcode}(&|$)`))

  // A fresh load of the link reopens the same bin.
  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)
  await expect(binCard).toContainText(`Barcode${barcode}`, {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
  await expect(binCard).toContainText('Selected bin')
  await expectVisiumHdBinDetails(binCard, barcode)
  await expectVisiumHdBinProfile(binCard)
})

// Reading all of barcode_mappings.parquet (110 MB, 1,123 row groups) sent
// 6,738 range requests at once, one per column chunk, and Chromium failed
// them with net::ERR_INSUFFICIENT_RESOURCES ("Network request failed: Failed
// to fetch"). The card now reads only the row groups that can hold the bin,
// with merged and limited range requests.
test('reads a Visium HD bin cell assignment from barcode_mappings.parquet @live', async ({
  page,
}) => {
  test.setTimeout(300_000)

  await openVisiumHdReferenceTissueLink(page)
  const binCard = await selectVisiumHdBinAtCentre(page)

  await expect(binCard.getByText('Reading all available mapping rows')).toHaveCount(0, {
    timeout: VISIUM_HD_BIN_ASSIGNMENT_TIMEOUT_MS,
  })
  await expect(binCard).toContainText(/Cell assignment(Loaded|Not found)/)
})

test('draws Visium HD cell and nucleus segmentation boundaries around the view @live', async ({
  page,
}) => {
  test.setTimeout(360_000)

  const visiumPanel = await openVisiumHdReferenceTissueLink(page)
  await expectVisiumHdBoundaryLayersOffByDefault(page)

  const cellsPanel = await openControls(page, 'cell-appearance')
  await cellsPanel.getByLabel('Cell boundaries').check()
  await cellsPanel.getByLabel('Nucleus boundaries').check()
  await expect(page).toHaveURL(/&cellBounds=1&nucleusBounds=1/)

  // The view holds about 2,400 bins, under the 50,000 boundary limit, so the
  // polygons load; the log counts those kept from each GeoJSON.
  await expectLogEntry(
    page,
    /Boundaries ready: [1-9][0-9,]* cells in [0-9,]+ ms, [1-9][0-9,]* nuclei in [0-9,]+ ms/,
    { timeout: VISIUM_HD_BOUNDARY_TIMEOUT_MS },
  )
  const log = page.getByRole('region', { name: 'Activity log' })
  await expect(log.getByText('Boundary load failed')).toHaveCount(0)
  await expect(log.getByText(/^Boundaries deferred/)).toHaveCount(0)
  await expect(page.getByText('Loading boundaries')).toHaveCount(0)
  await expect(page.locator('.viewport-message-error')).toHaveCount(0)
  await expect(visiumPanel).toContainText('54,504 at 16 µm')
})

// 3.4 million 2 µm bins take 7-15 s and 2 GB of JS heap locally (42 s with
// 150 ms latency and a 6x CPU slowdown emulated), so they get a test of their
// own.
test('switches Visium HD to 2 um bins, read exactly once zoomed in @live', async ({
  page,
}) => {
  test.setTimeout(160_000)
  test.slow()

  const visiumPanel = await openVisiumHdReferenceTissueLink(page)
  const twoMicrometers = visiumPanel.getByRole('button', { name: '2 µm' })
  await twoMicrometers.click()
  await expect(twoMicrometers).toHaveAttribute('aria-pressed', 'true')

  // Below zoom 3 the 16 µm bins stand in for the selected 2 µm ones.
  await expect(visiumPanel).toContainText('54,504 at 16 µm view; 2 µm selected', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })

  const zoomIn = page.getByRole('group', { name: 'Zoom' }).getByRole('button', {
    name: /^Zoom in/,
  })
  for (let step = 0; step < 3; step += 1) {
    await zoomIn.click()
  }
  await expect(visiumPanel).toContainText('3,443,936 at 2 µm', {
    timeout: VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS,
  })
  await expectLogEntry(
    page,
    /Visium HD 2 µm view ready for selected 2 µm bins: 3,443,936 in /,
  )

  const binCard = await selectVisiumHdBinAtCentre(page)
  const barcode = await binCard.getByText(/^s_002um_\d{5}_\d{5}-1$/).innerText()
  await expectVisiumHdBinDetails(binCard, barcode)
  await expectVisiumHdBinProfile(binCard)

  await page
    .getByRole('group', { name: 'Zoom' })
    .getByRole('button', { name: /^Zoom out/ })
    .click()
  await expect(visiumPanel).toContainText('54,504 at 16 µm view; 2 µm selected', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
})
