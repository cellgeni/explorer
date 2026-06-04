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
