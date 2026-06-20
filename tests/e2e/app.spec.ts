import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const VISIUM_HD_REFERENCE_URL =
  'https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f'
const VISIUM_HD_LOAD_TIMEOUT_MS = 90_000

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

test('loads the Visium HD reference dataset with tissue image and 16 um bins', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await loadVisiumHdReferenceDataset(page)
})

test('exercises Visium HD tiers, Feature Slice genes, ROI export, and advanced controls', async ({
  page,
}) => {
  test.setTimeout(180_000)

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

  await page.getByLabel('2 µm budget').fill('1')
  await expect(visiumPanel.getByRole('button', { name: '2 µm' })).toBeEnabled()
  await expect(visiumPanel.getByRole('button', { name: '2 µm' })).toHaveAttribute(
    'title',
    '2 µm bins',
  )

  await page.getByRole('tab', { name: 'Layers' }).click()
  const layersPanel = page.locator('#hud-panel-layers')
  await expect(layersPanel.getByLabel('Cell boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Cell boundaries')).toBeChecked()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).toBeEnabled()
  await expect(layersPanel.getByLabel('Nucleus boundaries')).toBeChecked()

  await page.getByRole('tab', { name: 'Genes' }).click()
  const genesPanel = page.locator('#hud-panel-genes')
  await genesPanel.getByRole('button', { name: 'A2M', exact: true }).click()
  await expect(genesPanel.getByTitle('Remove A2M')).toBeVisible()
  await expect(genesPanel.locator('.analysis-status')).toContainText(
    /Expression overview: [1-9][0-9,]* positive cells across 54,504 slide cells/,
    { timeout: 60_000 },
  )

  await page.getByRole('tab', { name: 'Dataset' }).click()
  await page.getByLabel('Mapping rows').fill('50')
  await expect(page.getByLabel('Mapping rows')).toHaveValue('50')

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
