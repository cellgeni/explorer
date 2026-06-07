import { expect, test } from '@playwright/test'

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
  await expect(page.getByRole('combobox', { name: 'Feature filter' })).toHaveValue(
    'all',
  )
  await expect(page.getByLabel('Feature search')).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Density color' })).toHaveValue(
    'thermal',
  )
  await expect(page.getByRole('combobox', { name: 'Point color' })).toHaveValue(
    'feature',
  )
})
