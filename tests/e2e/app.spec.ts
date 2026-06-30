import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const VISIUM_HD_REFERENCE_URL =
  'https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f'
const H5AD_PBMC3K_REFERENCE_URL = 'https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad'
const XENIUM_LOAD_TIMEOUT_MS = 120_000
const XENIUM_TRANSCRIPT_TIMEOUT_MS = 120_000
const XENIUM_ROI_TIMEOUT_MS = 120_000
const VISIUM_HD_LOAD_TIMEOUT_MS = 90_000
const H5AD_LOAD_TIMEOUT_MS = 60_000
const H5AD_HOSTED_LOAD_TIMEOUT_MS = 120_000
const HOSTED_FIXTURE_PREFLIGHT_TIMEOUT_MS = 10_000

async function loadDefaultXeniumDataset(page: Page) {
  await page.goto('/')

  await expect(page.getByLabel('Dataset URL')).toHaveValue(/\/public\/xenium\//)
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

  await page.getByLabel('Dataset URL').fill(VISIUM_HD_REFERENCE_URL)
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
  const bytes = await createTinyH5adFixture()
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
  obs.create_attribute('column-order', ['cluster', 'score'])
  obs.create_dataset({
    name: 'cell_id',
    data: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
  })
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

test('shows the scaffolded viewer shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Hide Controls' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Dataset URL')).toHaveValue(/\/public\/xenium\//)
  await expect(page.getByRole('button', { name: 'Load Dataset' })).toBeVisible()
})

test('shows transcript overlay controls in the browser shell', async ({ page }) => {
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

test('loads a local H5AD fixture with obs tracks and gene expression', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await routeTinyH5adFixture(page)
  await page.goto('/')

  const fixtureUrl = new URL('/h5ad-smoke.h5ad', page.url()).toString()
  await page.getByLabel('Dataset URL').fill(fixtureUrl)
  await page.getByRole('button', { name: 'Load Dataset' }).click()

  await expect(page.getByText(/H5AD ready: 4 cells, 3 genes/)).toBeVisible({
    timeout: H5AD_LOAD_TIMEOUT_MS,
  })
  await expect(
    page.getByRole('img', { name: 'Spatial viewer canvas area' }),
  ).toBeVisible()

  await expect(page.getByRole('tab', { name: 'Transcripts' })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await expect(
    genesPanel.getByRole('button', { name: 'Actb', exact: true }),
  ).toBeVisible()
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')

  await genesPanel.getByRole('button', { name: 'Actb', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression: [1-9][0-9,]* cells/,
    { timeout: H5AD_LOAD_TIMEOUT_MS },
  )

  await genesPanel.getByLabel('Cell color').selectOption('metadata')
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

test('loads the hosted PBMC3K H5AD fixture', async ({ page }) => {
  test.setTimeout(180_000)

  await page.goto('/')

  test.skip(
    !(await hostedFixtureAvailable(page, H5AD_PBMC3K_REFERENCE_URL)),
    'Hosted PBMC3K H5AD fixture is unavailable.',
  )

  await page.getByLabel('Dataset URL').fill(H5AD_PBMC3K_REFERENCE_URL)
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
  await expect(genesPanel.getByLabel('Cell color')).toHaveValue('annotations')
  await genesPanel.getByLabel('Gene selection').fill('CD79A')
  await genesPanel.getByRole('button', { name: 'CD79A', exact: true }).click()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression: [1-9][0-9,]* cells/,
    { timeout: H5AD_HOSTED_LOAD_TIMEOUT_MS },
  )

  await genesPanel.getByLabel('Cell color').selectOption('metadata')
  await expect(genesPanel.getByLabel('Metadata track')).toContainText('n_genes')
})

test('exercises the live Xenium dataset, morphology, transcripts, ROI, and cell panels', async ({
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

test('loads the Visium HD reference dataset with tissue image and 16 um bins', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await loadVisiumHdReferenceDataset(page)
  await expectVisiumHdBoundaryLayersOffByDefault(page)
})

test('exercises Visium HD tiers, Feature Slice genes, ROI export, and advanced controls', async ({
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
    /Expression overview: [1-9][0-9,]* positive cells across 54,504 slide cells/,
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
