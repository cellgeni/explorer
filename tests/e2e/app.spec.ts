import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  collectAxeFindings,
  expectAxeFindingsMatchBaseline,
  type AxeFindings,
} from './axe'
import { expectLogEntry, openControls, panelMenuButton } from './controls'
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
// STHELAR bone marrow (BioImage Archive S-BIAD2146): a zipped Zarr v2
// SpatialData store whose `he` image is placed with x and y swapped and
// flipped, and whose `nucleus_boundaries` shapes sit beside `cell_boundaries`.
const STHELAR_BONE_MARROW_URL =
  'https://ftp.ebi.ac.uk/biostudies/fire/S-BIAD/146/S-BIAD2146/Files/STHELAR/sdata_slides/sdata_bone_marrow_s0.zarr.zip'
// About 30 s locally: the table, the 19 MB compressed cell shapes, then the
// 19 MB nucleus shapes when nuclei are first shown.
const STHELAR_LOAD_TIMEOUT_MS = 300_000
// Bone marrow at four screen pixels per micrometre: about 1,900 cells and
// nuclei in view at 1280 × 720.
const STHELAR_TISSUE_VIEW = '5218,-1861,0,2'
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
// The first boundary request reads the whole cell (68 MB) and nucleus (44 MB)
// segmentation GeoJSON into an index; later viewports select from it.
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

// Enter opens the bin under the viewer's crosshair (15.5-D).
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
  // and the Embedding, Plots and Cell Query windows, empty and with data.
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

    await openControls(page, 'plots')
    await collectAxeFindings(page, `${state}, plots`, findings)
    await page.getByRole('button', { name: 'Close plots' }).click()

    await openControls(page, 'query')
    await collectAxeFindings(page, `${state}, cell query`, findings)
    await page.getByRole('button', { name: 'Close cell query' }).click()
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

  // The Screenshot popover (plan 27).
  await page.getByRole('button', { name: 'Screenshot' }).click()
  await collectAxeFindings(page, 'H5AD fixture, screenshot', findings)
  await page.keyboard.press('Escape')

  // The dot plot and its table (plan 22-I).
  const clusters = await openControls(page, 'clusters')
  await clusters.getByLabel('Annotation set').selectOption({ label: 'cluster' })
  await clusters.getByRole('button', { name: 'Load Annotations' }).click()
  const plots = await openControls(page, 'plots')
  await expect(plots.getByRole('img', { name: /^Dot plot of Actb/ })).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await collectAxeFindings(page, 'H5AD fixture, dot plot', findings)
  await plots.getByRole('switch', { name: 'Show numbers' }).click()
  await collectAxeFindings(page, 'H5AD fixture, dot plot numbers', findings)
  await plots.getByRole('switch', { name: 'Show numbers' }).click()

  // The violin and the heatmap (plan 22-F, 22-G).
  for (const [option, name] of [
    ['Violin', /^Violin plot of Actb/],
    ['Heatmap', /^Heatmap of Actb/],
  ] as const) {
    await plots.getByRole('combobox', { name: 'Plot' }).selectOption({ label: option })
    await expect(plots.getByRole('img', { name })).toBeVisible()
    await collectAxeFindings(page, `H5AD fixture, ${option.toLowerCase()}`, findings)
  }

  // A condition, its classes and the table of matches (plan 23-J).
  const query = await openControls(page, 'query')
  await query
    .getByRole('combobox', { name: 'Add condition' })
    .selectOption({ label: 'cluster (2)' })
  await query.getByRole('checkbox', { name: /^B/ }).check()
  await expect(query.getByText('2 of 4 cells match')).toBeVisible()
  await collectAxeFindings(page, 'H5AD fixture, cell query', findings)

  expectAxeFindingsMatchBaseline(findings)
})

// Plan 23: find cells by a cluster, sort and select them, export the table
// and save them as a class.
test('finds cells by cluster, exports them and saves them as a class @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await routeTinyH5adFixture(page)
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page
    .getByLabel('Dataset or image URL')
    .fill(new URL('/h5ad-smoke.h5ad', page.url()).toString())
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const query = await openControls(page, 'query')
  await expect(query.getByText('4 cells, no conditions')).toBeVisible()
  await query
    .getByRole('combobox', { name: 'Add condition' })
    .selectOption({ label: 'cluster (2)' })
  await query.getByRole('checkbox', { name: /^B/ }).check()
  await expect(query.getByText('2 of 4 cells match')).toBeVisible()
  await expect(page).toHaveURL(/panel=[^&]*query/)
  await expect(page).toHaveURL(/[#&]query=[^&]*%7Cin%7C/)

  const table = query.getByRole('table', { name: 'Matching cells' })
  const rows = table.getByRole('row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText('B')
  const firstId = (await rows.nth(1).getByRole('button').textContent()) ?? ''
  await rows.nth(1).getByRole('button').click()
  await expect(page).toHaveURL(
    new RegExp(`[#&]card=cell%3A${encodeURIComponent(firstId)}`),
  )

  const download = page.waitForEvent('download')
  await query.getByRole('button', { name: 'Export CSV' }).click()
  const csv = await readFile(await (await download).path(), 'utf8')
  expect((await download).suggestedFilename()).toBe('h5ad-smoke-cell-query.csv')
  expect(csv.split('\n')).toHaveLength(3)
  expect(csv.split('\n')[0]).toBe('cell_id,cluster')

  await query.getByRole('button', { name: 'Save As Class' }).click()
  await expect(page).toHaveURL(/[#&]cellColor=annotations(&|$)/)
  await expect(page.getByText('Query 1').first()).toBeVisible()
})

// Plan 22: select genes, load a set, open Plots, read the numbers and
// export them, then switch to the violin and the heatmap and export a PNG.
test('plots the selected genes by cluster and exports the numbers @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await routeTinyH5adFixture(page)
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page
    .getByLabel('Dataset or image URL')
    .fill(new URL('/h5ad-smoke.h5ad', page.url()).toString())
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
  await genesPanel.getByRole('button', { name: 'Gad1', exact: true }).click()
  const clusters = await openControls(page, 'clusters')
  await clusters.getByLabel('Annotation set').selectOption({ label: 'cluster' })
  await clusters.getByRole('button', { name: 'Load Annotations' }).click()

  const plots = await openControls(page, 'plots')
  await expect(
    plots.getByRole('img', { name: /^Dot plot of Actb and Gad1 across 2 groups/ }),
  ).toBeVisible({ timeout: H5AD_LOAD_TIMEOUT_MS })
  await expect(page).toHaveURL(/panel=[^&]*plots/)

  await plots.getByRole('switch', { name: 'Show numbers' }).click()
  await expect(plots.getByRole('table').getByRole('row')).toHaveText([
    'GroupGeneCells% expressingMean log1p(counts)',
    'AActb250%0.347',
    'BActb2100%1.59',
    'AGad1250%0.805',
    'BGad1250%0.693',
  ])

  const download = page.waitForEvent('download')
  await plots.getByRole('button', { name: 'Export CSV' }).click()
  const csv = await readFile(await (await download).path(), 'utf8')
  expect((await download).suggestedFilename()).toBe('h5ad-smoke-dot-plot-cluster.csv')
  expect(csv.split('\n').slice(0, 2)).toEqual([
    'set,group,group_kind,gene,values,cells,cells_expressing,percent_expressing,mean,median,q1,q3,min,max,median_expressing,q1_expressing,q3_expressing',
    'cluster,A,class,Actb,log1p(counts),2,1,50,0.346574,0.346574,0.173287,0.51986,0,0.693147,0.693147,0.693147,0.693147',
  ])
  await plots.getByRole('switch', { name: 'Show numbers' }).click()

  // Each gene's violins on its own axis; the link keeps the plot.
  await plots.getByRole('combobox', { name: 'Plot' }).selectOption({ label: 'Violin' })
  const violin = plots.getByRole('img', {
    name: /^Violin plot of Actb and Gad1 across 2 groups/,
  })
  await expect(violin).toBeVisible()
  await expect(violin.locator('path')).toHaveCount(4)
  await expect(page).toHaveURL(/[#&]plot=violin(&|$)/)

  // The heatmap is a canvas; hovering a tile gives its numbers.
  await plots.getByRole('combobox', { name: 'Plot' }).selectOption({ label: 'Heatmap' })
  const heatmap = plots.getByRole('img', { name: /^Heatmap of Actb and Gad1/ })
  await expect(heatmap).toBeVisible()
  await heatmap.locator('canvas').hover({ position: { x: 5, y: 5 } })
  await expect(plots.getByText('A, Actb: 2 cells, 50% expressing')).toBeVisible()
  await expect(page).toHaveURL(/[#&]plot=heatmap(&|$)/)

  const pngDownload = page.waitForEvent('download')
  await plots.getByRole('button', { name: 'Export PNG' }).click()
  const png = await readFile(await (await pngDownload).path())
  expect((await pngDownload).suggestedFilename()).toBe('h5ad-smoke-heatmap-cluster.png')
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
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

// Review tasks 1-5 (plan 15.5-D) with the keyboard alone: open a
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

  // 4. Open a cell: the skip link moves to the view without changing the
  // address, which would reload the page; Enter then opens the cell at the
  // centre of the view. Zoom out until one is there.
  const canvas = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  await page.getByRole('link', { name: 'Skip To Spatial View' }).focus()
  await page.keyboard.press('Enter')
  await expect(canvas).toBeFocused()
  expect(page.url()).not.toContain('viewer-heading')
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

  // A second load, held at its first request, is cancelled from the loading
  // list. Its log entry's title holds "open dataset", which the dataset
  // menu's button must not be confused with.
  let releasePending = () => {}
  const pendingReleased = new Promise<void>((resolve) => {
    releasePending = resolve
  })
  await page.route('**/h5ad-pending.h5ad', async (route) => {
    await pendingReleased
    await route.abort().catch(() => {})
  })
  const openForm = await openControls(page, 'open-dataset')
  await openForm
    .getByLabel('Dataset or image URL')
    .fill(new URL('/h5ad-pending.h5ad', page.url()).toString())
  await openForm.getByRole('button', { name: 'Load Dataset' }).click()
  const loading = page.getByRole('status', { name: 'Active loading tasks' })
  await expect(loading).toContainText('h5ad-pending.h5ad')
  await loading.getByRole('button', { name: 'Cancel loading dataset' }).click()
  releasePending()

  await expectLogEntry(
    page,
    /^Cancelled loading h5ad-pending\.h5ad; the open dataset stays$/,
  )
  const info = await openControls(page, 'dataset-info')
  await expect(info).toContainText('h5ad-smoke.h5ad')
})

test.describe('at 390 × 844 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // The layer panel is a bottom sheet and the window toggles a menu
  // (EXP-038); the other smoke tests run at the desktop size.
  test('picks a gene and opens a window from the Panels menu @smoke', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await routeTinyH5adFixture(page)
    await page.goto('/')

    await openControls(page, 'open-dataset')
    await page
      .getByLabel('Dataset or image URL')
      .fill(new URL('/h5ad-smoke.h5ad', page.url()).toString())
    await openControls(page, 'open-dataset')
    await page.getByRole('button', { name: 'Load Dataset' }).click()
    await expectLogEntry(page, /H5AD ready: 4 cells, 3 genes/, {
      timeout: H5AD_LOAD_TIMEOUT_MS,
    })
    await page.getByRole('button', { name: 'Close Dataset info' }).click()

    const genesPanel = await openControls(page, 'genes')
    await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
    await expect(genesPanel.locator('.analysis-status')).toContainText(
      'Expression all cells: 3 positive cells across 4 slide cells',
      { timeout: H5AD_LOAD_TIMEOUT_MS },
    )

    // The menu holds all three window toggles an H5AD with embeddings has.
    const menu = panelMenuButton(page)
    await menu.click()
    await expect(
      page.getByRole('dialog', { name: 'Panels' }).getByRole('button'),
    ).toHaveText(['Embedding', 'Plots', 'Query', 'Python'])
    await menu.click()

    // Focus moves into the window and, when it closes, back to the menu.
    const queryWindow = await openControls(page, 'query')
    const close = queryWindow.getByRole('button', { name: 'Close cell query' })
    await expect(close).toBeFocused()
    await close.click()
    await expect(queryWindow).toBeHidden()
    await expect(menu).toBeFocused()
  })
})

// The top bar's popovers hang from their buttons, so on a phone those near
// the middle or the edge ran off the screen, and in a short window Help ran
// off the bottom and scrolled the page (EXP-297, EXP-301).
test('keeps the top bar popovers on a phone screen and in a short window @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await routeTinyH5adFixture(page)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/?dataset=%2Fh5ad-smoke.h5ad')
  await expect(page.getByRole('status').filter({ hasText: '4 cells' })).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const onScreen = async (name: string) => {
    const box = await page.getByRole('dialog', { name }).boundingBox()
    expect(box, name).not.toBeNull()
    const { x, width } = box ?? { x: 0, width: 0 }
    expect(x, `${name} left edge`).toBeGreaterThanOrEqual(0)
    expect(x + width, `${name} right edge`).toBeLessThanOrEqual(320)
  }
  for (const name of ['Tools', 'Panels', 'Help']) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await onScreen(name)
    await page.keyboard.press('Escape')
  }

  // Help in a landscape phone's height: it scrolls inside itself from its
  // top, and the top bar stays on the screen.
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'Help' })
  await expect(help).toBeFocused()
  const state = await help.evaluate((panel) => ({
    bottom: panel.getBoundingClientRect().bottom,
    scrolls: panel.scrollHeight > panel.clientHeight,
    scrollTop: panel.scrollTop,
    barTop: document.querySelector('.shell-top-bar')?.getBoundingClientRect().top,
  }))
  expect(state).toEqual({
    bottom: expect.any(Number),
    scrolls: true,
    scrollTop: 0,
    barTop: 0,
  })
  expect(state.bottom).toBeLessThanOrEqual(390)
  await page.keyboard.press('Tab')
  await expect(help.getByRole('link', { name: 'User guide' })).toBeFocused()
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

interface WebglContextCounts {
  // Contexts neither lost nor garbage collected.
  readonly live: number
  // Contexts the browser took while their canvas was still on the page.
  readonly lostOnPage: number
}

// Counts the page's WebGL contexts. Chromium keeps 16 live contexts per page
// and takes the oldest past that, which is the 2D view's, so every deck.gl
// canvas must give its context back when it closes.
async function trackWebglContexts(
  page: Page,
): Promise<() => Promise<WebglContextCounts>> {
  await page.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext: (type: string, ...rest: unknown[]) => RenderingContext | null
    }
    const getContext = prototype.getContext
    const seen = new WeakSet<RenderingContext>()
    const contexts: WeakRef<WebGLRenderingContext>[] = []
    let lostOnPage = 0
    prototype.getContext = function (this: HTMLCanvasElement, type, ...rest) {
      const context = getContext.call(this, type, ...rest)
      if (
        context instanceof WebGLRenderingContext ||
        context instanceof WebGL2RenderingContext
      ) {
        if (!seen.has(context)) {
          seen.add(context)
          contexts.push(new WeakRef(context))
          this.addEventListener('webglcontextlost', () => {
            if (this.isConnected) lostOnPage += 1
          })
        }
      }
      return context
    }
    Object.assign(window, {
      webglContextCounts: (): WebglContextCounts => ({
        live: contexts.filter((ref) => ref.deref()?.isContextLost() === false).length,
        lostOnPage,
      }),
    })
  })
  return () =>
    page.evaluate(() =>
      (
        window as unknown as { webglContextCounts: () => WebglContextCounts }
      ).webglContextCounts(),
    )
}

// Sections of 20 cells in one AnnData file: obs `section` (s1, s2, …) and
// `z_um` (0, 10, …), and an obsm `spatial` whose third column is each cell's
// z, so a section has a 3D cell view and the collection a 3D stack.
async function createSections3dH5ad(sectionCount = 2): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/playwright-${randomUUID()}.h5ad`
  const cells = Array.from({ length: sectionCount * 20 }, (_cell, index) => ({
    section: Math.floor(index / 20),
    x: (index % 5) * 20,
    y: Math.floor((index % 20) / 5) * 20,
    z: Math.floor(index / 20) * 10 + (index % 3),
  }))
  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  obs.create_attribute('_index', '_index')
  obs.create_attribute('column-order', ['section', 'z_um'])
  obs.create_dataset({
    name: '_index',
    data: cells.map((_cell, index) => `cell-${index}`),
  })
  const section = obs.create_group('section')
  section.create_attribute('encoding-type', 'categorical')
  section.create_dataset({
    name: 'categories',
    data: Array.from({ length: sectionCount }, (_section, index) => `s${index + 1}`),
  })
  section.create_dataset({
    name: 'codes',
    data: new Int8Array(cells.map((cell) => cell.section)),
  })
  obs.create_dataset({
    name: 'z_um',
    data: new Float64Array(cells.map((cell) => cell.section * 10)),
  })
  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', '_index')
  varGroup.create_dataset({ name: '_index', data: ['GeneA', 'GeneB'] })
  file.create_dataset({
    name: 'X',
    data: new Float32Array(cells.flatMap((cell) => [1, cell.section])),
    shape: [cells.length, 2],
  })
  file.create_group('obsm').create_dataset({
    name: 'spatial',
    data: new Float64Array(cells.flatMap((cell) => [cell.x, cell.y, cell.z])),
    shape: [cells.length, 3],
  })
  file.close()
  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

test('gives back the WebGL context of each closed 3D view, side-by-side section and section @smoke', async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)

  const webglContexts = await trackWebglContexts(page)
  await routeH5adBytes(page, '/sections-3d.h5ad', await createSections3dH5ad())
  const link = new URLSearchParams({
    collection: new URL('/sections-3d.h5ad', baseURL).toString(),
  })
  await page.goto(`/#${link.toString()}`)
  const bar = page.getByRole('navigation', { name: 'Collection' })
  await expect(bar.getByRole('button', { name: 's1', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
  await expect.poll(async () => (await webglContexts()).live).toBe(1)
  await expect(bar.getByRole('button', { name: 'Previews' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Twice each, so a context kept by the first closing shows.
  const cells = await openControls(page, 'cell-appearance')
  const cellView = cells.getByRole('group', { name: 'Cell view' })
  const cells3d = page.getByRole('region', { name: '3D cells' })
  const stackToggle = bar.getByRole('button', { name: 'Stack in 3D' })
  const stack = page.getByRole('region', { name: '3D section stack' })
  const beside = page.locator('.linked-section canvas')
  for (const other of ['s2', 's1']) {
    await cellView.getByRole('button', { name: '3D' }).click()
    await expect(cells3d.locator('canvas')).toHaveCount(1)
    await cellView.getByRole('button', { name: '2D' }).click()
    await expect(cells3d).toHaveCount(0)
    await expect
      .poll(async () => (await webglContexts()).live, { message: '3D cell view' })
      .toBe(1)

    await stackToggle.click()
    await expect(stack.locator('canvas')).toHaveCount(1)
    await stackToggle.click()
    await expect(stack).toHaveCount(0)
    await expect
      .poll(async () => (await webglContexts()).live, { message: '3D section stack' })
      .toBe(1)

    const besideToggle = bar.getByRole('button', { name: `Show ${other} beside` })
    await besideToggle.click()
    await expect(beside).toHaveCount(1)
    await besideToggle.click()
    await expect(beside).toHaveCount(0)
    await expect
      .poll(async () => (await webglContexts()).live, { message: 'side by side' })
      .toBe(1)

    // Opening the other section replaces the 2D view's canvas.
    await bar.getByRole('button', { name: other, exact: true }).click()
    await expect(bar.getByRole('button', { name: other, exact: true })).toHaveAttribute(
      'aria-current',
      'true',
      { timeout: H5AD_LOAD_TIMEOUT_MS },
    )
    await expect
      .poll(async () => (await webglContexts()).live, { message: 'section switch' })
      .toBe(1)
  }
  expect((await webglContexts()).lostOnPage).toBe(0)
})

test('has no accessibility violations with a 3D view open @smoke', async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)
  const findings: AxeFindings = new Map()
  await routeH5adBytes(page, '/sections-3d.h5ad', await createSections3dH5ad())
  const link = new URLSearchParams({
    collection: new URL('/sections-3d.h5ad', baseURL).toString(),
  })
  await page.goto(`/#${link.toString()}`)
  const bar = page.getByRole('navigation', { name: 'Collection' })
  await expect(bar.getByRole('button', { name: 's1', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )

  // Each 3D view hides its canvas from assistive technology, so deck.gl's
  // focusable root inside it must leave the tab order.
  const cells = await openControls(page, 'cell-appearance')
  const cellView = cells.getByRole('group', { name: 'Cell view' })
  await cellView.getByRole('button', { name: '3D' }).click()
  await expect(
    page.getByRole('region', { name: '3D cells' }).locator('canvas'),
  ).toHaveCount(1)
  await page.waitForTimeout(500)
  await collectAxeFindings(page, '3D cell view', findings)
  await cellView.getByRole('button', { name: '2D' }).click()

  const stackToggle = bar.getByRole('button', { name: 'Stack in 3D' })
  await stackToggle.click()
  await expect(
    page.getByRole('region', { name: '3D section stack' }).locator('canvas'),
  ).toHaveCount(1)
  await page.waitForTimeout(500)
  await collectAxeFindings(page, '3D section stack', findings)
  await stackToggle.click()

  expectAxeFindingsMatchBaseline(findings)
})

// The collection bar's heading is as wide as its title, so no dataset covers
// its buttons, with previews, names only, expanded and narrow. A wide font,
// as on Linux, is forced, since macOS fonts hid a heading too narrow for the
// buttons; 30 sections fill the bar, so the heading would shrink if it could.
test('keeps the collection bar buttons clear of its datasets @smoke', async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)
  const findings: AxeFindings = new Map()

  await routeH5adBytes(page, '/sections-3d.h5ad', await createSections3dH5ad(30))
  const link = new URLSearchParams({
    collection: new URL('/sections-3d.h5ad', baseURL).toString(),
  })
  await page.goto(`/#${link.toString()}`)
  await page.addStyleTag({
    content:
      "body, body * { font-family: Verdana, 'DejaVu Sans', sans-serif !important }",
  })
  const bar = page.getByRole('navigation', { name: 'Collection' })
  await expect(bar.getByRole('button', { name: 's1', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
  const previews = bar.getByRole('button', { name: 'Previews' })
  await expect(previews).toHaveAttribute('aria-pressed', 'true')
  await expect(bar.getByRole('button', { name: 'Stack in 3D' })).toBeVisible()

  async function expectButtonsClear(state: string) {
    const problems = await bar.evaluate((nav) => {
      const heading = nav.querySelector('.collection-bar-heading')
      if (heading === null) return ['no heading']
      const bounds = heading.getBoundingClientRect()
      return [...heading.querySelectorAll('button')].flatMap((button) => {
        const box = button.getBoundingClientRect()
        const name = button.getAttribute('aria-label') ?? button.title
        if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) {
          return [`${name} is outside the heading`]
        }
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        return hit !== null && button.contains(hit)
          ? []
          : [`${name} is covered by ${hit?.getAttribute('class') ?? 'nothing'}`]
      })
    })
    expect(problems, state).toEqual([])
    await expectPreviewsDrawn(state)
    await collectAxeFindings(page, `collection, ${state}`, findings)
  }

  // While a preview is read its button also shows "Loading…", which axe
  // counts as part of the button's label (label-content-name-mismatch), so
  // which buttons it flagged depended on the reads still running. Before a
  // scan, the previews in view have drawn their cells and no read runs,
  // wherever the rows fall. A preview in view that is never read fails here.
  async function expectPreviewsDrawn(state: string) {
    await expect
      .poll(
        () =>
          bar.evaluate((nav) => {
            if (nav.querySelector('.collection-bar-preview[data-loading]') !== null) {
              return ['a preview is being read']
            }
            const groups = nav.querySelector('.collection-bar-groups')
            if (groups === null) return ['no datasets']
            const view = groups.getBoundingClientRect()
            return [...nav.querySelectorAll('.collection-bar-dataset')].flatMap(
              (button) => {
                const canvas = button.querySelector('canvas')
                const box = button.getBoundingClientRect()
                const inView =
                  box.right > view.left &&
                  box.left < view.right &&
                  box.bottom > view.top &&
                  box.top < view.bottom
                if (canvas === null || !inView) return []
                const pixels = canvas
                  .getContext('2d')
                  ?.getImageData(0, 0, canvas.width, canvas.height).data
                const drawn = pixels?.some((value, index) => index % 4 === 3 && value > 0)
                return drawn === true
                  ? []
                  : [`${button.getAttribute('aria-label') ?? '?'} has no preview`]
              },
            )
          }),
        { message: `previews drawn (${state})`, timeout: H5AD_LOAD_TIMEOUT_MS },
      )
      .toEqual([])
  }

  await expectButtonsClear('previews')
  await previews.click()
  await expect(previews).toHaveAttribute('aria-pressed', 'false')
  await expectButtonsClear('names only')
  await previews.click()
  await bar.getByRole('button', { name: 'Expand' }).click()
  await expect(bar.getByRole('button', { name: 'Collapse' })).toBeVisible()
  await expectButtonsClear('expanded')
  await bar.getByRole('button', { name: 'Collapse' }).click()

  // Narrow, the heading keeps only the kicker and its buttons.
  await page.setViewportSize({ width: 800, height: 720 })
  await expect(bar.getByText('30 datasets')).toBeHidden()
  await expectButtonsClear('narrow, previews')
  await previews.click()
  await expect(previews).toHaveAttribute('aria-pressed', 'false')
  await expectButtonsClear('narrow, names only')

  // At 400% zoom of a 1280 × 720 window, the map keeps half the room the bar
  // shares with it, the bar stays clear of the layer sheet, and the previews
  // give way to the names (EXP-298).
  await previews.click()
  await expect(previews).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 320, height: 180 })
  const room = await page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect()
    const preview = document.querySelector('.collection-bar-preview')
    return {
      map: Math.round(box('.viewport-frame')?.height ?? 0),
      barUnderSheet: Math.max(
        0,
        Math.round(
          (box('.collection-bar')?.bottom ?? 0) - (box('.shell-layer-sheet')?.top ?? 0),
        ),
      ),
      previewShown: preview !== null && getComputedStyle(preview).display !== 'none',
    }
  })
  expect(room.map).toBeGreaterThan(30)
  expect(room).toMatchObject({ barUnderSheet: 0, previewShown: false })

  expectAxeFindingsMatchBaseline(findings)
})

// A one-channel OME-Zarr z-stack (Zarr v2) of 4 planes of 16 × 16 pixels,
// whose Image section offers the 3D view. Other paths answer 404.
async function routeZStackOmeZarr(page: Page, path = '/z-stack.ome.zarr') {
  const json = (value: unknown) => Buffer.from(JSON.stringify(value))
  const files = new Map([
    ['.zgroup', json({ zarr_format: 2 })],
    [
      '.zattrs',
      json({
        multiscales: [
          {
            version: '0.4',
            axes: [
              { name: 'c', type: 'channel' },
              { name: 'z', type: 'space', unit: 'micrometer' },
              { name: 'y', type: 'space', unit: 'micrometer' },
              { name: 'x', type: 'space', unit: 'micrometer' },
            ],
            datasets: [
              {
                path: '0',
                coordinateTransformations: [{ type: 'scale', scale: [1, 2, 0.5, 0.5] }],
              },
            ],
          },
        ],
      }),
    ],
    [
      '0/.zarray',
      json({
        zarr_format: 2,
        shape: [1, 4, 16, 16],
        chunks: [1, 4, 16, 16],
        dtype: '|u1',
        compressor: null,
        fill_value: 0,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      }),
    ],
    [
      '0/0/0/0/0',
      Buffer.from(Uint8Array.from({ length: 4 * 16 * 16 }, (_v, i) => i % 251)),
    ],
  ])
  await page.route(
    (url) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    async (route) => {
      const name = new URL(route.request().url()).pathname.slice(path.length + 1)
      const body = files.get(name)
      const headers = { 'Access-Control-Allow-Origin': '*' }
      await route.fulfill(
        body === undefined
          ? { status: 404, headers }
          : {
              status: 200,
              headers: { ...headers, 'Content-Length': String(body.byteLength) },
              ...(route.request().method() === 'HEAD' ? {} : { body }),
            },
      )
    },
  )
}

test('gives back the WebGL context of each closed 3D volume view @smoke', async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)

  const webglContexts = await trackWebglContexts(page)
  await routeZStackOmeZarr(page)
  const link = new URLSearchParams({
    dataset: new URL('/z-stack.ome.zarr', baseURL).toString(),
  })
  await page.goto(`/#${link.toString()}`)
  await expect(
    page.getByRole('status').filter({ hasText: 'Image · 1 channel' }),
  ).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  const image = await openControls(page, 'image')
  const imageView = image.getByRole('group', { name: 'Image view' })
  const volume = page.getByRole('region', { name: '3D view' })
  for (let round = 1; round <= 2; round += 1) {
    await imageView.getByRole('button', { name: '3D' }).click()
    await expect(volume.locator('canvas')).toHaveCount(1)
    await imageView.getByRole('button', { name: '2D' }).click()
    await expect(volume).toHaveCount(0)
    await expect.poll(async () => (await webglContexts()).live).toBe(1)
  }
  expect((await webglContexts()).lostOnPage).toBe(0)
})

// Serves src/test/fixtures/<folder>/<name> (see make_fixtures.py and the
// other scripts there) at /<name>, with byte ranges, suffix ranges and HEAD
// as a bucket answers them: sharded Zarr v3 arrays read their index from the
// end of a shard.
async function routeFixtureFolder(page: Page, folder: string, name: string) {
  await page.route(`**/${name}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    let bytes: Buffer

    try {
      bytes = await readFile(
        new URL(`../../src/test/fixtures/${folder}${path}`, import.meta.url),
      )
    } catch {
      await route.fulfill({
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      return
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers()['range'] ?? '')
    const suffix = match !== null && match[1] === ''
    const start =
      match === null ? 0 : suffix ? bytes.byteLength - Number(match[2]) : Number(match[1])
    const end =
      match === null || suffix || match[2] === ''
        ? bytes.byteLength - 1
        : Math.min(bytes.byteLength - 1, Number(match[2]))
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      ...(match === null
        ? {}
        : { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` }),
    }
    await route.fulfill(
      route.request().method() === 'HEAD'
        ? { status: 200, headers }
        : {
            status: match === null ? 200 : 206,
            headers,
            body: bytes.subarray(start, end + 1),
          },
    )
  })
}

// Serves src/test/fixtures/icechunk/<repository> (see make_fixtures.py there)
// at the same path.
async function routeIcechunkFixture(page: Page, repository: string) {
  await routeFixtureFolder(page, 'icechunk', repository)
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
    /Expression all spots: 0 positive spots across 70 slide spots/,
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
    /Expression all spots: 70 positive spots across 70 slide spots/,
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
    /Expression all spots: 18 positive spots across 36 slide spots/,
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
})

// A MERSCOPE region folder as the instrument writes it: three cells with
// 19-digit IDs, three genes and two Blank columns, and boundaries with one row
// per cell per z plane (src/test/fixtures/merscope). Other paths answer 404,
// so detection falls through to MERSCOPE.
async function routeMerscopeFixture(
  page: Page,
  folder = '/merscope-smoke',
  options: { readonly vzg?: boolean } = {},
) {
  const fixtures = 'src/test/fixtures/merscope'
  const files: Record<string, { body: Buffer; type: string }> = {
    ...(options.vzg === true
      ? {
          // The .vzg's name carries the run, so a manifest names it.
          'explorer.json': {
            type: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                version: 1,
                platform: 'merscope',
                files: { vzg: 'region_0.vzg' },
              }),
            ),
          },
          'region_0.vzg': {
            type: 'application/zip',
            body: await readFile(`${fixtures}/region_0.vzg`),
          },
        }
      : {}),
    'cell_by_gene.csv': {
      type: 'text/csv',
      body: await readFile(`${fixtures}/cell_by_gene.csv`),
    },
    'cell_metadata.csv': {
      type: 'text/csv',
      body: await readFile(`${fixtures}/cell_metadata.csv`),
    },
    'cell_boundaries.parquet': {
      type: 'application/octet-stream',
      body: await readFile(`${fixtures}/cell_boundaries.parquet`),
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
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()['range'] ?? '')

    if (range !== null && route.request().method() !== 'HEAD') {
      const start = Number(range[1])
      const end = Math.min(Number(range[2]) + 1, file.body.byteLength)
      await route.fulfill({
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - start) },
        body: file.body.subarray(start, end),
      })
      return
    }

    await route.fulfill(
      route.request().method() === 'HEAD'
        ? { status: 200, headers }
        : { status: 200, headers, body: file.body },
    )
  })
}

test('shows a MERSCOPE .vzg stain and switches it off @smoke', async ({ page }) => {
  await routeMerscopeFixture(page, '/merscope-vzg', { vzg: true })
  await page.goto('/')

  const datasetUrl = new URL('/merscope-vzg/', page.url()).toString()
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /MERSCOPE ready: 3 cells/, { timeout: H5AD_LOAD_TIMEOUT_MS })
  await expectLogEntry(page, /Morphology image ready/, { timeout: H5AD_LOAD_TIMEOUT_MS })
  const image = await openControls(page, 'image')
  await expect(image.getByTitle('MERSCOPE stain to show')).toHaveValue('DAPI')
  await expect(image.getByTitle('MERSCOPE z plane to show')).toContainText('z3 (19 KiB)')
  await expect(image.getByLabel('Image channels')).toContainText('DAPI')

  await image.getByTitle('MERSCOPE stain to show').selectOption('')
  await expectLogEntry(page, /MERSCOPE image change: none/)
  await expect(page).toHaveURL(/mimg=none/, { timeout: H5AD_LOAD_TIMEOUT_MS })
  await expect(
    (await openControls(page, 'image')).getByTitle('MERSCOPE stain to show'),
  ).toHaveValue('', { timeout: H5AD_LOAD_TIMEOUT_MS })
})

// Plan 26: Cell Query measures the .vzg stain under each cell, a disc of
// the Radius field's 5 µm as MERSCOPE cells have no area. The fixture's
// cells' DAPI means at 2 µm/px are about 1,927, 1,987 and 1,430
// (tifffile and numpy), and 1,810, 1,926 and 1,304 at 0.5 µm/px.
test('finds MERSCOPE cells by a stain measured under each @smoke', async ({ page }) => {
  test.setTimeout(120_000)
  await routeMerscopeFixture(page, '/merscope-vzg', { vzg: true })
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page
    .getByLabel('Dataset or image URL')
    .fill(new URL('/merscope-vzg/', page.url()).toString())
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /MERSCOPE ready: 3 cells/, { timeout: H5AD_LOAD_TIMEOUT_MS })
  await expectLogEntry(page, /Morphology image ready/, { timeout: H5AD_LOAD_TIMEOUT_MS })

  const query = await openControls(page, 'query')
  const addCondition = query.getByRole('combobox', { name: 'Add condition' })
  const mean = addCondition.locator('optgroup[label="Image"] option', {
    hasText: /^DAPI mean \(2 µm\/px, radius 5 µm\)$/,
  })
  await addCondition.selectOption((await mean.getAttribute('value')) ?? '')
  const from = query.getByRole('spinbutton', { name: 'From' })
  await from.fill('1700')
  await from.press('Enter')

  await expect(query.getByText('2 of 3 cells match')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(
    /[#&]query=image%3Amean%3A2%3Ar5%3A[^&]*%7Cat-least%7C1700/,
  )
  await expect(query.getByRole('spinbutton', { name: 'Radius' })).toHaveValue('5')
  await expectLogEntry(page, /Cell query: measured DAPI at level 2 in /)

  const findings: AxeFindings = new Map()
  await openControls(page, 'query')
  await collectAxeFindings(page, 'MERSCOPE fixture, image condition', findings)
  expectAxeFindingsMatchBaseline(findings)

  // A finer level is another column, measured again.
  await query.getByRole('combobox', { name: 'Resolution' }).selectOption({ index: 0 })
  await expect(
    query.getByTitle('DAPI mean (0.5 µm/px, radius 5 µm)', { exact: true }),
  ).toBeVisible()
  await expect(query.getByText('2 of 3 cells match')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(page, /Cell query: measured DAPI at level 0 in /)
})

// Plan 26, M2: a SpatialData store's OME-Zarr image, measured chunk by
// chunk. The store (src/test/fixtures/spatialdata/make_image_store.py) has 6
// cells at the centres of 24 µm blocks of one value each: DAPI 500 to 5,500
// in steps of 1,000, and CD3 4,000 and 1,000 in turn. Discs of the Radius
// field's 5 µm stay inside the blocks, so they measure those values.
test('finds SpatialData cells by image channels measured under each @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await routeFixtureFolder(page, 'spatialdata', 'image_cells.zarr')
  await page.goto('/')

  await openControls(page, 'open-dataset')
  await page
    .getByLabel('Dataset or image URL')
    .fill(new URL('/image_cells.zarr', page.url()).toString())
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()
  await expectLogEntry(page, /SpatialData ready: 6 cells/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(page, /Morphology image ready/, { timeout: H5AD_LOAD_TIMEOUT_MS })

  const query = await openControls(page, 'query')
  const addCondition = query.getByRole('combobox', { name: 'Add condition' })
  const option = (label: RegExp) =>
    addCondition.locator('optgroup[label="Image"] option', { hasText: label })
  await addCondition.selectOption(
    (await option(/^DAPI mean \(2 µm\/px, radius 5 µm\)$/).getAttribute('value')) ?? '',
  )
  const from = query.getByRole('spinbutton', { name: 'From' })
  await from.fill('3000')
  await from.press('Enter')

  await expect(query.getByText('3 of 6 cells match')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(
    /[#&]query=image%3Amean%3A1%3Ar5%3AChannel%3A0%7Cat-least%7C3000/,
  )
  await expectLogEntry(page, /Cell query: measured DAPI at level 1 in /)
  // Each level's read is at most its chunks decoded.
  await expect(
    query.getByRole('combobox', { name: 'Resolution' }).locator('option'),
  ).toHaveText(['1 µm/px, under 0.1 MiB', '2 µm/px, under 0.1 MiB (default)'])

  // CD3 above Otsu's threshold over at least half of each disc.
  await addCondition.selectOption(
    (await option(/^CD3 % above [\d,]+ \(2 µm\/px, radius 5 µm\)$/).getAttribute(
      'value',
    )) ?? '',
  )
  await expect(query.getByText('1 of 6 cells match')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const findings: AxeFindings = new Map()
  await openControls(page, 'query')
  await collectAxeFindings(page, 'SpatialData fixture, image conditions', findings)
  expectAxeFindingsMatchBaseline(findings)

  // The finer level, measured again.
  await query
    .getByRole('combobox', { name: 'Resolution' })
    .first()
    .selectOption({ index: 0 })
  await expect(
    query.getByTitle('DAPI mean (1 µm/px, radius 5 µm)', { exact: true }),
  ).toBeVisible()
  await expect(query.getByText('1 of 6 cells match')).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(page, /Cell query: measured DAPI at level 0 in /)
})

test('loads a MERSCOPE region folder with its cell outlines and genes @smoke', async ({
  page,
}) => {
  await routeMerscopeFixture(page)
  await page.goto('/')

  const datasetUrl = new URL('/merscope-smoke/', page.url()).toString()
  await openControls(page, 'open-dataset')
  await page.getByLabel('Dataset or image URL').fill(datasetUrl)
  await openControls(page, 'open-dataset')
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expectLogEntry(page, /MERSCOPE ready: 3 cells, 3 genes/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(page, /2 Blank columns summed into blank_count/)
  await expect(
    page.getByRole('status').filter({ hasText: 'MERSCOPE · 3 cells' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: 'Layers' })
      .getByRole('button', { name: /^Transcripts/ }),
  ).toHaveCount(0)

  const cellsPanel = await openControls(page, 'cell-appearance')
  await expect(cellsPanel.getByLabel('Cell boundaries', { exact: true })).toBeChecked()
  await expectLogEntry(page, /MERSCOPE cell boundaries ready: 3 cells at z plane 3/, {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })

  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByLabel('Gene selection').fill('GENE_B')
  await genesPanel.getByRole('button', { name: 'GENE_B', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all cells: 1 positive cell across 3 slide cells/,
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
  await expect(genesPanel.getByRole('button', { name: 'Blank-0' })).toHaveCount(0)
})

// A little-endian, uncompressed, single-strip grayscale TIFF of `bits`-bit
// samples, value(x, y) at each pixel, with an optional ImageDescription
// (OME-XML for an OME-TIFF).
function tinyTiff(
  width: number,
  height: number,
  bits: 8 | 32,
  value: (x: number, y: number) => number,
  description?: string,
): Buffer {
  const bytesPerSample = bits / 8
  const pixels = Buffer.alloc(width * height * bytesPerSample)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * bytesPerSample

      if (bits === 8) pixels.writeUInt8(value(x, y), offset)
      else pixels.writeUInt32LE(value(x, y), offset)
    }
  }

  const ASCII = 2
  const SHORT = 3
  const LONG = 4
  const pixelOffset = 8
  const text =
    description === undefined ? null : Buffer.from(`${description}\0`, 'latin1')
  // [tag, type, value, count]; the description's value is its offset.
  const entries: readonly (readonly [number, number, number, number])[] = [
    [256, LONG, width, 1],
    [257, LONG, height, 1],
    [258, SHORT, bits, 1],
    [259, SHORT, 1, 1],
    [262, SHORT, 1, 1],
    ...(text === null ? [] : [[270, ASCII, 0, text.byteLength] as const]),
    [273, LONG, pixelOffset, 1],
    [277, SHORT, 1, 1],
    [278, LONG, height, 1],
    [279, LONG, pixels.byteLength, 1],
  ]
  const ifdOffset = pixelOffset + pixels.byteLength + (pixels.byteLength % 2)
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4)
  ifd.writeUInt16LE(entries.length, 0)
  entries.forEach(([tag, type, entryValue, count], index) => {
    const offset = 2 + index * 12
    ifd.writeUInt16LE(tag, offset)
    ifd.writeUInt16LE(type, offset + 2)
    ifd.writeUInt32LE(count, offset + 4)
    if (type === ASCII) ifd.writeUInt32LE(ifdOffset + ifd.byteLength, offset + 8)
    else if (type === SHORT) ifd.writeUInt16LE(entryValue, offset + 8)
    else ifd.writeUInt32LE(entryValue, offset + 8)
  })
  const header = Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0])
  header.writeUInt32LE(ifdOffset, 4)

  return Buffer.concat([
    header,
    pixels,
    Buffer.alloc(ifdOffset - pixelOffset - pixels.byteLength),
    ifd,
    ...(text === null ? [] : [text]),
  ])
}

// Serves files under `folder` with HEAD and Range requests, as object
// storage does; other paths answer 404.
async function routeRangeFiles(
  page: Page,
  folder: string,
  files: Readonly<Record<string, Buffer>>,
) {
  await page.route(`**${folder}/**`, async (route) => {
    const request = route.request()
    const body = files[new URL(request.url()).pathname.slice(folder.length + 1)]

    if (body === undefined) {
      await route.fulfill({
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      return
    }

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers()['range'] ?? '')

    if (request.method() === 'HEAD' || range === null) {
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'Content-Length': String(body.byteLength) },
        ...(request.method() === 'HEAD' ? {} : { body }),
      })
      return
    }

    const start = Number(range[1])
    const end = Math.min(
      body.byteLength - 1,
      range[2] === '' ? body.byteLength - 1 : Number(range[2]),
    )
    await route.fulfill({
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${body.byteLength}`,
      },
      body: body.subarray(start, end + 1),
    })
  })
}

test('decodes image tiles with one set of workers across contrast edits @smoke', async ({
  page,
  baseURL,
}) => {
  // Each contrast value has its own tile cache; they share the decode workers.
  const started: string[] = []
  const alive = new Set<object>()
  page.on('worker', (worker) => {
    if (!worker.url().includes('tileDecode')) return
    started.push(worker.url())
    alive.add(worker)
    worker.on('close', () => alive.delete(worker))
  })
  // One channel, named in the OME-XML, so the Image section has its contrast.
  const omeXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">',
    '<Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8"',
    ' SizeX="64" SizeY="64" SizeC="1" SizeZ="1" SizeT="1"',
    ' PhysicalSizeX="0.5" PhysicalSizeY="0.5">',
    '<Channel ID="Channel:0:0" Name="rings" SamplesPerPixel="1"/>',
    '<TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>',
  ].join('')
  await routeRangeFiles(page, '/contrast-smoke', {
    'slide.ome.tif': tinyTiff(64, 64, 8, (x, y) => (x * 4 + y) % 256, omeXml),
  })
  const folder = new URL('/contrast-smoke/', baseURL).toString()
  await page.goto(`/#dataset=${encodeURIComponent(`${folder}slide.ome.tif`)}`)
  await expect(
    page.getByRole('status').filter({ hasText: 'Image · 1 channel' }),
  ).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  const image = await openControls(page, 'image')
  const maximum = image.getByLabel('rings maximum')
  await expect.poll(() => started.length).toBeGreaterThan(0)

  for (let edit = 1; edit <= 10; edit += 1) {
    await maximum.fill(String(250 - edit * 10))
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(1000)
  expect(alive.size).toBeLessThanOrEqual(8)
})

test("has no accessibility violations in an image's channel controls @smoke", async ({
  baseURL,
  page,
}) => {
  test.setTimeout(120_000)
  const findings: AxeFindings = new Map()
  const omeXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">',
    '<Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8"',
    ' SizeX="64" SizeY="64" SizeC="1" SizeZ="1" SizeT="1"',
    ' PhysicalSizeX="0.5" PhysicalSizeY="0.5">',
    '<Channel ID="Channel:0:0" Name="rings" SamplesPerPixel="1"/>',
    '<TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>',
  ].join('')
  await routeRangeFiles(page, '/channels-axe', {
    'slide.ome.tif': tinyTiff(64, 64, 8, (x, y) => (x * 4 + y) % 256, omeXml),
  })
  const slide = new URL('/channels-axe/slide.ome.tif', baseURL).toString()

  // Wide, as the review measured, and at phone width, where the layers are a
  // sheet that opens from its handle.
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height })
    await page.goto(`/#dataset=${encodeURIComponent(slide)}`)
    await expect(
      page.getByRole('status').filter({ hasText: 'Image · 1 channel' }),
    ).toBeVisible({ timeout: H5AD_LOAD_TIMEOUT_MS })
    // Under 860 px the layers are a sheet, opened from its handle, whose
    // name also holds "Image".
    const layers = page.getByRole('complementary', { name: 'Layers' })
    if (width < 860) await page.getByTitle('Expand Layers', { exact: true }).click()
    const section = layers.getByRole('heading', { level: 3 }).getByTitle(/ Image$/)
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
    await expect(layers.getByRole('img', { name: 'rings histogram' })).toBeVisible()
    await collectAxeFindings(page, `image channel controls, ${width} px`, findings)
  }

  expectAxeFindingsMatchBaseline(findings)
})

test('draws an image channel in the colour picked for it @smoke', async ({
  baseURL,
  page,
}) => {
  // OME Color -16776961 is 0xFF0000FF: the channel opens red.
  const omeXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">',
    '<Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8"',
    ' SizeX="64" SizeY="64" SizeC="1" SizeZ="1" SizeT="1"',
    ' PhysicalSizeX="0.5" PhysicalSizeY="0.5">',
    '<Channel ID="Channel:0:0" Name="rings" Color="-16776961" SamplesPerPixel="1"/>',
    '<TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>',
  ].join('')
  await routeRangeFiles(page, '/colour-smoke', {
    'slide.ome.tif': tinyTiff(64, 64, 8, (x, y) => (x * 4 + y) % 256, omeXml),
  })
  const folder = new URL('/colour-smoke/', baseURL).toString()
  await page.goto(`/#dataset=${encodeURIComponent(`${folder}slide.ome.tif`)}`)
  await expect(
    page.getByRole('status').filter({ hasText: 'Image · 1 channel' }),
  ).toBeVisible({ timeout: H5AD_LOAD_TIMEOUT_MS })
  const image = await openControls(page, 'image')

  await expect
    .poll(async () => {
      const [red = 0, green = 0] = await meanImageColour(page)
      return red > 20 && green === 0
    })
    .toBe(true)

  // The tiles already drawn are redrawn in the new colour (EXP-043).
  await image.getByLabel('rings color').fill('#00ff00')
  await expect
    .poll(async () => {
      const [red = 0, green = 0] = await meanImageColour(page)
      return green > 20 && red === 0
    })
    .toBe(true)
})

// The mean red, green and blue over the middle of the image canvas.
async function meanImageColour(page: Page): Promise<readonly number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.morphology-canvas')
    const context = canvas?.getContext('2d')
    if (canvas === null || context === null || context === undefined) return []
    const width = Math.floor(canvas.width * 0.4)
    const height = Math.floor(canvas.height * 0.4)
    const { data } = context.getImageData(
      Math.floor(canvas.width * 0.3),
      Math.floor(canvas.height * 0.3),
      width,
      height,
    )
    const sums = [0, 0, 0]
    for (let index = 0; index < data.length; index += 4) {
      sums[0] += data[index] ?? 0
      sums[1] += data[index + 1] ?? 0
      sums[2] += data[index + 2] ?? 0
    }
    return sums.map((sum) => sum / (width * height))
  })
}

test('draws an imported label mask and WKT outlines over an image @smoke', async ({
  page,
  baseURL,
}) => {
  // A 64 x 64 image with four 32-bit labels, one past 65,535 as Cellpose
  // writes them over that many cells, and two WKT polygons in pixels.
  await routeRangeFiles(page, '/segmentation-smoke', {
    'slide.tif': tinyTiff(64, 64, 8, (x, y) => (x + y) % 256),
    'mask.tif': tinyTiff(64, 64, 32, (x, y) =>
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
    'cells.csv': Buffer.from(
      'cell_id,geometry\na,"POLYGON ((2 2, 20 2, 20 20, 2 20, 2 2))"\nb,"POLYGON ((30 30, 60 30, 45 60, 30 30))"\n',
    ),
  })
  const folder = new URL('/segmentation-smoke/', baseURL).toString()
  await page.goto(
    `/#dataset=${encodeURIComponent(`${folder}slide.tif`)}&segmentation=${encodeURIComponent(`${folder}mask.tif`)}&panel=segmentation`,
  )

  const section = page.locator('[data-layer-section="segmentation"]')
  await expect(section).toContainText('Label TIFF · 64 × 64', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(section).toContainText('4 outlines drawn.', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(/segmentation=.*mask\.tif/)

  await section.getByRole('button', { name: 'Remove mask.tif' }).click()
  await section.getByLabel('Segmentation URL').fill(`${folder}cells.csv`)
  await section.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(section).toContainText('WKT · 2', { timeout: H5AD_LOAD_TIMEOUT_MS })
  await expect(section).toContainText('2 outlines drawn.', {
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(page).toHaveURL(/segmentation=.*cells\.csv/)
})

// Plan 27: a 2× PNG of an image with outlines over it, with its dpi and text
// chunks, that looks as the screen does.
test('saves a 2× screenshot of the view that matches the screen @smoke', async ({
  page,
  baseURL,
}) => {
  const webglContexts = await trackWebglContexts(page)
  await routeRangeFiles(page, '/screenshot-smoke', {
    // Bright on the left, dark on the right, so a misplaced image shows.
    'slide.tif': tinyTiff(64, 64, 8, (x, y) => (x < 32 ? 200 : 20 + ((x + y) % 16))),
    'cells.csv': Buffer.from(
      'cell_id,geometry\na,"POLYGON ((8 8, 56 8, 56 56, 8 56, 8 8))"\n',
    ),
  })
  const folder = new URL('/screenshot-smoke/', baseURL).toString()
  await page.goto(
    `/#dataset=${encodeURIComponent(`${folder}slide.tif`)}&segmentation=${encodeURIComponent(`${folder}cells.csv`)}&panel=segmentation`,
  )
  await expect(page.locator('[data-layer-section="segmentation"]')).toContainText(
    '1 outline drawn.',
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )
  // The view keeps still, with its image drawn.
  await page.waitForTimeout(1_000)
  const frame = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  const box = await frame.boundingBox()
  if (box === null) throw new Error('The view has no box.')
  const screen = await frame.screenshot()

  await page.getByRole('button', { name: 'Screenshot' }).click()
  const dialog = page.getByRole('dialog', { name: /high-resolution PNG/ })
  await expect(dialog.getByRole('button', { name: '2×' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Only the map, to compare with the screen.
  for (const mark of ['Scale bar', 'Legend', 'Axes', 'Selections']) {
    await dialog.getByRole('checkbox', { name: mark }).uncheck()
  }
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save PNG' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('slide-screenshot.png')
  await expect(dialog.getByText('Saved slide-screenshot.png.')).toBeVisible()
  // The screenshot's Deck gave its WebGL context back once it left the
  // page, so the view keeps its own and counts no loss.
  await expect.poll(async () => (await webglContexts()).live).toBe(1)
  expect((await webglContexts()).lostOnPage).toBe(0)
  const png = await readFile(await download.path())

  const chunks = pngChunks(png)
  expect(chunks.map((chunk) => chunk.type).slice(0, 2)).toEqual(['IHDR', 'pHYs'])
  expect([chunks[0]?.data.readUInt32BE(0), chunks[0]?.data.readUInt32BE(4)]).toEqual([
    Math.round(box.width) * 2,
    Math.round(box.height) * 2,
  ])
  // 300 dpi is 11,811 pixels per metre.
  expect(chunks[1]?.data.readUInt32BE(0)).toBe(11_811)
  const text = Object.fromEntries(
    chunks
      .filter((chunk) => chunk.type === 'tEXt')
      .map((chunk) => {
        const nul = chunk.data.indexOf(0)
        return [
          chunk.data.subarray(0, nul).toString('latin1'),
          chunk.data.subarray(nul + 1).toString('latin1'),
        ]
      }),
  )
  expect(text.Software).toMatch(/^Spatial Omics Explorer/)
  expect(text.Source).toBe(`${folder}slide.tif`)
  expect(text.Description).toMatch(/µm per pixel; 2× scale$/)
  expect(text['Creation Time']).toMatch(/^\d{4}-\d\d-\d\dT/)

  // Halved, the PNG is the screen: the image in place and the outline over
  // it. The middle of the view leaves out the readouts and the minimap.
  const difference = await page.evaluate(
    async ({ pngBase64, screenBase64 }) => {
      const decode = (base64: string) =>
        createImageBitmap(
          new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))]),
        )
      const [saved, shown] = await Promise.all([decode(pngBase64), decode(screenBase64)])
      const pixels = (image: ImageBitmap) => {
        const canvas = document.createElement('canvas')
        canvas.width = shown.width
        canvas.height = shown.height
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('No 2D canvas.')
        context.drawImage(image, 0, 0, shown.width, shown.height)
        return context.getImageData(
          Math.floor(shown.width * 0.25),
          Math.floor(shown.height * 0.25),
          Math.floor(shown.width * 0.5),
          Math.floor(shown.height * 0.5),
        ).data
      }
      const [a, b] = [pixels(saved), pixels(shown)]
      let total = 0
      let largest = 0
      for (let index = 0; index < a.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = Math.abs((a[index + channel] ?? 0) - (b[index + channel] ?? 0))
          total += delta
          largest = Math.max(largest, delta)
        }
      }
      return { mean: total / ((a.length / 4) * 3), largest }
    },
    { pngBase64: png.toString('base64'), screenBase64: screen.toString('base64') },
  )
  expect(difference.mean).toBeLessThan(6)
})

function pngChunks(png: Buffer): { readonly type: string; readonly data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = []
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('latin1')
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return chunks
}

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
    /Expression all spots: [1-9][0-9,]* positive spots across 370 slide spots/,
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
  // Azimuth classes take the colours Atera stores beside the column.
  await expect(
    annotationsPanel.getByLabel('azimuth_broad: Epithelial cell color'),
  ).toHaveValue('#007b96')

  // With UMOD selected, Atera transcripts are its density from
  // binned_transcripts.zarr.zip; for all features they are cell-summary squares.
  const transcriptsPanel = await openControls(page, 'transcripts')
  const transcriptSummary = transcriptsPanel.getByLabel('Transcript overlay summary')
  await page.getByRole('checkbox', { name: 'Show transcripts', exact: true }).check()
  await expect(transcriptsPanel).toContainText(
    /Showing native 1 selected-feature density squares at QV 20\+ from binned_transcripts\.zarr\.zip/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )
  await expect(transcriptSummary).toContainText('Per-gene LOD + exact')
  await expect(transcriptSummary).toContainText(/Rendered[1-9][0-9,]* squares/)
  await expect(page.getByRole('checkbox', { name: 'Gene-only calls' })).toBeDisabled()

  // Density follows Min QV: QV 30 bins UMOD's rows from transcripts.zarr.zip,
  // or, over the rows one view reads (whole-slide UMOD is), says so. The
  // field applies a typed value on Enter or blur.
  const minQv = transcriptsPanel.getByRole('spinbutton', { name: 'Min QV' })
  await minQv.fill('30')
  await minQv.press('Enter')
  await expect(transcriptsPanel).toContainText(
    /at QV 30\+ from transcripts\.zarr\.zip|Min QV 30 needs [0-9,]+ transcript rows here/,
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )
  await minQv.fill('20')
  await minQv.press('Enter')

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

  // The cell at the centre of the view: its UMOD transcripts by z.
  const canvas = page.getByRole('img', { name: 'Spatial viewer canvas area' })
  await canvas.focus()
  const cellCard = page.getByRole('region', { name: 'Cell', exact: true })
  for (let step = 0; step < 6 && !(await cellCard.isVisible()); step += 1) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1_000)
    if (!(await cellCard.isVisible())) await page.keyboard.press('ArrowRight')
  }
  const cellZ = cellCard.getByLabel('Cell transcript z-axis distribution')
  await expect(cellZ).toContainText(/[0-9,]+ z records/, {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
  await expect(cellZ).toContainText('UMOD')
  await cellCard.getByRole('button', { name: 'Clear selected cell' }).click()

  // Magic Lens summarises the view's cells from the matrix.
  const magicLens = await openControls(page, 'magic-lens')
  await magicLens.getByRole('button', { name: 'Summarise View' }).click()
  const magicLensCard = page.getByRole('region', { name: 'Magic Lens', exact: true })
  await expect(magicLensCard.getByLabel('Magic lens gene distribution')).toContainText(
    'UMOD',
    { timeout: ATERA_LOAD_TIMEOUT_MS },
  )
  await magicLensCard.getByRole('button', { name: 'Clear Magic Lens' }).click()

  // ROI transcript export: the selected genes' transcripts in the box.
  const boxTool = page.getByRole('button', { name: 'Box selection' })
  await boxTool.click()
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  if (canvasBox === null) return
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.4,
    canvasBox.y + canvasBox.height * 0.4,
  )
  await page.mouse.down()
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6,
    canvasBox.y + canvasBox.height * 0.6,
    { steps: 10 },
  )
  await page.mouse.up()
  const roiCard = page.getByRole('region', { name: 'ROI 1' })
  await expect(roiCard).toContainText(/[1-9][0-9,]* cells? · /, {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
  const downloadPromise = page.waitForEvent('download')
  await roiCard.getByRole('button', { name: 'Export Transcripts' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('roi-1-transcripts.csv')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  if (downloadPath === null) return
  const transcriptRows = (await readFile(downloadPath, 'utf8')).trim().split('\n')
  expect(transcriptRows[0]).toBe(
    'cell_id,feature_name,x_location,y_location,z_location,qv,overlaps_nucleus,is_gene',
  )
  expect(transcriptRows[1]).toContain(',UMOD,')

  // The 3D DAPI stack replaces the 2D image and gets Z plane.
  const imagePanel = await openControls(page, 'image')
  await imagePanel.getByLabel('Morphology', { exact: true }).selectOption('3d')
  await expect(page).toHaveURL(/aimg=3d/, { timeout: ATERA_LOAD_TIMEOUT_MS })
  await expect(await openControls(page, 'image')).toContainText(/8 \/ 15/, {
    timeout: ATERA_LOAD_TIMEOUT_MS,
  })
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

  // About 0.7% of the demo's transcripts are outside every cell (cell_id
  // UNASSIGNED); they export with an empty cell_id rather than failing.
  const transcriptsDownloadPromise = page.waitForEvent('download', {
    timeout: XENIUM_ROI_TIMEOUT_MS,
  })
  await selectionCard.getByRole('button', { name: 'Export Transcripts' }).click()
  const transcriptsDownload = await transcriptsDownloadPromise
  expect(transcriptsDownload.suggestedFilename()).toBe('roi-1-transcripts.csv')
  const transcriptsPath = await transcriptsDownload.path()
  expect(transcriptsPath).not.toBeNull()

  if (transcriptsPath !== null) {
    const transcriptRows = (await readFile(transcriptsPath, 'utf8')).trim().split('\n')
    expect(transcriptRows[0]).toBe(
      'cell_id,feature_name,x_location,y_location,z_location,qv,overlaps_nucleus,is_gene',
    )
    expect(transcriptRows.length).toBeGreaterThan(1)
  }

  // The Cell card shows only once a cell is clicked.
  await expect(page.getByRole('region', { name: 'Cell', exact: true })).toHaveCount(0)
})

// Plan 22, M2: the Plots panel reads SNAP25 in every cell of the demo from
// cell_feature_matrix.zarr.zip and groups it by the graph clusters. The time
// to the first plot goes into the report.
test('plots SNAP25 by the Xenium graph clusters @live', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const startedAt = Date.now()

  await page.goto(
    `/#xv=2&dataset=${encodeURIComponent(XENIUM_DEMO_URL)}&groups=analysis:0&genes=SNAP25&panel=plots`,
  )
  const plots = page.getByRole('region', { name: 'Plots' })
  await expect(
    plots.getByRole('img', { name: /^Dot plot of SNAP25 across [1-9][0-9]* groups/ }),
  ).toBeVisible({ timeout: XENIUM_LOAD_TIMEOUT_MS })
  testInfo.annotations.push({
    type: 'Time to first plot',
    description: `${((Date.now() - startedAt) / 1000).toFixed(1)} s from opening the link`,
  })

  await plots.getByRole('switch', { name: 'Show numbers' }).click()
  await expect(plots.getByRole('row', { name: /^Cluster 1 SNAP25/ })).toContainText(
    /SNAP25[1-9][0-9,]*[0-9.]+%/,
  )
  await expectLogEntry(page, /Plots: read 1 gene \(about [0-9.]+ MiB\) in /)
})

// Plan 23: Cell Query matches the demo's 1.4 million cells by transcript
// count and a graph cluster read for the query alone, in its worker, and
// draws the first page of pictures with their outlines. The times to the
// first count and to the first page of pictures go into the report.
test('finds Xenium cells by transcript count and graph cluster @live', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000)
  const startedAt = Date.now()
  const query = 'cell:transcripts|at-least|400;set:dataset-set:analysis:0|in|analysis:0:0'

  await page.goto(
    `/#xv=2&dataset=${encodeURIComponent(XENIUM_DEMO_URL)}&panel=query&query=${encodeURIComponent(query)}`,
  )
  const panel = page.getByRole('region', { name: 'Cell Query' })
  await expect(panel.getByText(/^[1-9][0-9,]* of 1,414,155 cells match$/)).toBeVisible({
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })
  testInfo.annotations.push({
    type: 'Time to first count',
    description: `${((Date.now() - startedAt) / 1000).toFixed(1)} s from opening the link`,
  })

  const rows = panel.getByRole('table', { name: 'Matching cells' }).getByRole('row')
  await expect(rows.nth(1)).toContainText('Cluster 1')

  // Pictures (plan 23-G, 23-H): 40 µm across, with the cell's outline from
  // cell_boundaries.parquet.
  const firstPicture = panel.getByRole('img', { name: /, 40 µm across$/ }).first()
  await expect(firstPicture.locator('.cell-query-outline path')).toBeAttached({
    timeout: XENIUM_BOUNDARY_TIMEOUT_MS,
  })
  testInfo.annotations.push({
    type: 'Time to first page of pictures',
    description: `${((Date.now() - startedAt) / 1000).toFixed(1)} s from opening the link`,
  })
  await expectLogEntry(page, /Cell query: [0-9,]+ of 1,414,155 match in /)
  await expectLogEntry(page, /Cell query: [0-9,]+ outlines? in [0-9,]+ ms/)
})

// Plan 26: a link with an image condition measures the demo's DAPI under
// all 1.4 million cells at the default level, 0.85 µm/px (180 MB), as it
// opens. The time to the count goes into the report.
test('finds Xenium cells by DAPI measured under each @live', async ({
  page,
}, testInfo) => {
  test.setTimeout(400_000)
  const startedAt = Date.now()
  const query = 'image:above:2:t2188:Channel:0|at-least|50'

  await page.goto(
    `/#xv=2&dataset=${encodeURIComponent(XENIUM_DEMO_URL)}&panel=query&query=${encodeURIComponent(query)}`,
  )
  const panel = page.getByRole('region', { name: 'Cell Query' })
  await expect(panel.getByText(/^Measuring DAPI… [0-9]+%$/)).toBeVisible({
    timeout: XENIUM_LOAD_TIMEOUT_MS,
  })
  await expect(panel.getByText(/^[1-9][0-9,]* of 1,414,155 cells match$/)).toBeVisible({
    timeout: 300_000,
  })
  testInfo.annotations.push({
    type: 'Time to measure DAPI',
    description: `${((Date.now() - startedAt) / 1000).toFixed(1)} s from opening the link`,
  })
  await expectLogEntry(page, /Cell query: measured DAPI at level 2 in [0-9.]+ s/)
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
    /Nucleus boundaries ready: [1-9][0-9,]* nuclei in [0-9,]+ ms/,
    {
      timeout: XENIUM_BOUNDARY_TIMEOUT_MS,
    },
  )
  const log = page.getByRole('region', { name: 'Activity log' })
  await expect(log.getByText(/^Cell boundaries started/)).toHaveCount(0)
  await expect(log.getByText('Nucleus boundary load failed')).toHaveCount(0)
  await expect(page.locator('.viewport-message-error')).toHaveCount(0)
})

// Plan 27: a 4× PNG of the whole slide draws every one of its 1.4 million
// cells, not the screen's sample, and reads the image at its scale.
test('saves a 4× screenshot of the whole Xenium slide @live', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000)

  await page.goto(`/#xv=2&dataset=${encodeURIComponent(XENIUM_DEMO_URL)}`)
  await expect(
    page.getByRole('status').filter({ hasText: /Xenium · 1\.41 M cells/ }),
  ).toBeVisible({ timeout: XENIUM_LOAD_TIMEOUT_MS })
  await page.getByRole('button', { name: 'Screenshot' }).click()
  const dialog = page.getByRole('dialog', { name: /high-resolution PNG/ })
  await dialog.getByRole('button', { name: '4×' }).click()
  await expect(dialog).toContainText(/Draws all 1,414,155 cells in view/)

  const startedAt = Date.now()
  const downloading = page.waitForEvent('download', { timeout: 240_000 })
  await dialog.getByRole('button', { name: /Save PNG|and save/ }).click()
  const download = await downloading
  testInfo.annotations.push({
    type: 'Time to a 4× PNG',
    description: `${((Date.now() - startedAt) / 1000).toFixed(1)} s from Save PNG`,
  })
  const png = await readFile(await download.path())
  const box = await page
    .getByRole('img', { name: 'Spatial viewer canvas area' })
    .boundingBox()
  // IHDR's width and height.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
    Math.round(box?.width ?? 0) * 4,
    Math.round(box?.height ?? 0) * 4,
  ])
  await expect(page.locator('.screenshot-deck-host')).toHaveCount(0)
})

test('draws STHELAR nuclei over its axis-swapped and flipped H&E @live', async ({
  page,
}) => {
  test.setTimeout(600_000)

  await page.goto(
    `/#dataset=${encodeURIComponent(STHELAR_BONE_MARROW_URL)}&sdImage=he&view=${encodeURIComponent(STHELAR_TISSUE_VIEW)}&cellBounds=1&nucleusBounds=1`,
  )

  // The H&E is shown, and the nucleus shapes are not among the elements left
  // out.
  await expectLogEntry(
    page,
    /SpatialData view: coordinate system global; image he; table table_cells/,
    { timeout: STHELAR_LOAD_TIMEOUT_MS },
  )
  const log = page.getByRole('region', { name: 'Activity log' })
  await expect(log.getByText(/not shown .*shapes\/nucleus_boundaries/)).toHaveCount(0)
  const cellsPanel = await openControls(page, 'cell-appearance')
  await expect(cellsPanel.getByLabel('Nucleus boundaries')).toBeChecked()

  // Every nucleus shares its index with a cell shape.
  await expectLogEntry(
    page,
    /SpatialData shapes nucleus_boundaries: 225,906 of 225,906 nuclei match table rows/,
    { timeout: STHELAR_LOAD_TIMEOUT_MS },
  )
  await expectLogEntry(page, /Cell boundaries ready: [1-9][0-9,]* cells in [0-9,]+ ms/, {
    timeout: STHELAR_LOAD_TIMEOUT_MS,
  })
  await expectLogEntry(
    page,
    /Nucleus boundaries ready: [1-9][0-9,]* nuclei in [0-9,]+ ms/,
    {
      timeout: STHELAR_LOAD_TIMEOUT_MS,
    },
  )
  await expect(log.getByText(/^(Cell|Nucleus) boundary load failed/)).toHaveCount(0)
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
    /Expression all bins: [1-9][0-9,]* positive bins across 54,504 slide bins/,
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

// deck.gl picks the bin on pointerdown, and under headless Chromium's
// software WebGL that pick can take over 250 ms, after which mjolnir.js
// dropped the click. Holding the click for 400 ms does the same on any
// machine.
test('opens a Visium HD bin card with a click @live', async ({ page }) => {
  test.setTimeout(300_000)

  await openVisiumHdReferenceTissueLink(page)
  await page
    .getByRole('img', { name: 'Spatial viewer canvas area' })
    .click({ delay: 400 })

  const binCard = page.getByRole('region', { name: 'Bin', exact: true })
  await expect(binCard).toContainText('Selected bin', { timeout: 30_000 })
  await expect(binCard.getByText(/^s_016um_\d{5}_\d{5}-1$/)).toBeVisible()
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

  const geojsonReads = new Map<string, number>()
  page.on('request', (request) => {
    const file = /\/segmented_outputs\/([^/?]+\.geojson)/.exec(request.url())?.[1]

    if (file !== undefined && request.method() === 'GET') {
      geojsonReads.set(file, (geojsonReads.get(file) ?? 0) + 1)
    }
  })

  const visiumPanel = await openVisiumHdReferenceTissueLink(page)
  await expectVisiumHdBoundaryLayersOffByDefault(page)

  const cellsPanel = await openControls(page, 'cell-appearance')
  await cellsPanel.getByLabel('Cell boundaries').check()
  await cellsPanel.getByLabel('Nucleus boundaries').check()
  await expect(page).toHaveURL(/&cellBounds=1&nucleusBounds=1/)

  // The view holds about 2,400 bins, under the 50,000 boundary limit, so the
  // polygons load; the log counts those kept from each GeoJSON.
  await expectLogEntry(page, /Cell boundaries ready: [1-9][0-9,]* cells in [0-9,]+ ms/, {
    timeout: VISIUM_HD_BOUNDARY_TIMEOUT_MS,
  })
  await expectLogEntry(
    page,
    /Nucleus boundaries ready: [1-9][0-9,]* nuclei in [0-9,]+ ms/,
    {
      timeout: VISIUM_HD_BOUNDARY_TIMEOUT_MS,
    },
  )
  const log = page.getByRole('region', { name: 'Activity log' })
  await expect(log.getByText(/^(Cell|Nucleus) boundary load failed/)).toHaveCount(0)
  await expect(log.getByText(/^Boundaries deferred/)).toHaveCount(0)
  await expect(page.getByText(/^Loading (cell|nucleus) boundaries$/)).toHaveCount(0)
  await expect(page.locator('.viewport-message-error')).toHaveCount(0)
  await expect(visiumPanel).toContainText('54,504 at 16 µm')

  // Panning past the padded request area queries boundaries again, from the
  // files already read.
  const ready = log.getByText(/Cell boundaries ready: /).first()
  const firstReady = await ready.innerText()
  await page.getByRole('img', { name: 'Spatial viewer canvas area' }).focus()
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Shift+ArrowDown')
  }
  await expect(ready).not.toHaveText(firstReady, {
    timeout: VISIUM_HD_BOUNDARY_TIMEOUT_MS,
  })
  await expect(ready).toHaveText(/Cell boundaries ready: [0-9,]+ cells in [0-9,]+ ms/)
  expect(Object.fromEntries(geojsonReads)).toEqual({
    'cell_segmentations.geojson': 1,
    'nucleus_segmentations.geojson': 1,
  })
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

test('opens a Visium HD dataset with only a 2 um tier and colours a gene zoomed out @live', async ({
  page,
}) => {
  test.setTimeout(VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS)
  test.slow()

  // A manifest listing only the reference run's 2 µm bins: they are placed by
  // feature_slice.h5's spot transform, with no positions file read.
  const manifestUrl = 'https://manifest.test/visium-hd-2um-only.json'
  await page.route(manifestUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        version: 1,
        platform: 'visium-hd',
        root: VISIUM_HD_REFERENCE_URL,
        files: { bins: [{ size: 2, path: 'binned_outputs/square_002um' }] },
      }),
    }),
  )
  const positionsRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('tissue_positions')) {
      positionsRequests.push(request.url())
    }
  })

  await page.goto(`/#xv=2&dataset=${encodeURIComponent(manifestUrl)}`)
  const visiumPanel = page.getByRole('region', { name: 'Visium HD dataset' })
  await expect(visiumPanel).toContainText('3,443,936 at 2 µm', {
    timeout: VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS,
  })
  expect(positionsRequests).toEqual([])

  // Zoomed out, 16 µm bins made from the 2 µm ones are coloured.
  const genesPanel = await openControls(page, 'genes')
  await genesPanel.getByRole('button', { name: 'A2M', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression all bins: [1-9][0-9,]* positive bins across 3,443,936 slide bins/,
    { timeout: VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS },
  )
})

test('loads Visium HD clusters for each bin size @live', async ({ page }) => {
  test.setTimeout(VISIUM_HD_TWO_MICROMETER_TIMEOUT_MS)

  const visiumPanel = await openVisiumHdReferenceTissueLink(page)
  const clusters = await openControls(page, 'clusters')
  const annotationSet = clusters.getByLabel('Annotation set')
  // Space Ranger's clusterings of the 16 µm bins; graph-based is chosen.
  await expect(annotationSet).toHaveValue(
    'visium-hd-clusters:16:gene_expression_graphclust',
    { timeout: VISIUM_HD_LOAD_TIMEOUT_MS },
  )
  await expect(annotationSet.locator('option', { hasText: 'kmeans 10' })).toHaveCount(1)
  await clusters.getByRole('button', { name: 'Load Annotations' }).click()
  const labels = clusters.getByRole('region', { name: 'graphclust labels' })
  await expect(labels).toContainText('54,504 bins', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
  await expect(labels).toContainText('Cluster 1')
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('Cluster 1')

  // The 8 µm bins have their own clustering, read when the size changes.
  await visiumPanel.getByRole('button', { name: '8 µm' }).click()
  await expect(visiumPanel).toContainText('215,320 at 8 µm', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })
  await expect(annotationSet).toHaveValue(
    'visium-hd-clusters:8:gene_expression_graphclust',
  )
  await expect(labels).toContainText('215,196 bins', {
    timeout: VISIUM_HD_LOAD_TIMEOUT_MS,
  })

  // 2 µm bins are not clustered.
  await visiumPanel.getByRole('button', { name: '2 µm' }).click()
  await expect(labels).toHaveCount(0, { timeout: VISIUM_HD_LOAD_TIMEOUT_MS })
  await expect(annotationSet).toHaveValue('none')
})
