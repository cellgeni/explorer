import { expect, type Locator, type Page } from '@playwright/test'
import { CONTROL_AREAS, type ControlArea } from '../../src/test/controlAreas'

// Shows the controls for an area (see src/test/controlAreas.ts) and returns
// the element that holds them: the start screen or the dataset menu, the info
// drawer, a layer section, a popover or the Embedding panel, opened unless it
// already is.
export async function openControls(page: Page, area: ControlArea): Promise<Locator> {
  const place = CONTROL_AREAS[area]

  switch (place.kind) {
    case 'dataset-menu': {
      // The start screen and the open info drawer have the same form; one
      // copy keeps labels unique.
      const startScreen = page.getByRole('region', { name: 'Open a dataset' })
      if (await startScreen.isVisible()) {
        await closeButton(infoButton(page))
        return startScreen
      }
      if (await isExpanded(infoButton(page))) {
        return page.getByRole('region', { name: 'Open another dataset' })
      }
      await openButton(page.getByTitle('Open dataset'))
      return page.getByRole('dialog', { name: 'Open dataset' })
    }
    case 'info-drawer':
      await closeButton(page.getByTitle('Open dataset'))
      await openButton(infoButton(page))
      return page.getByRole('dialog', { name: 'Dataset info' })
    case 'section': {
      const layers = page.getByRole('complementary', { name: 'Layers' })
      await openButton(layers.getByRole('button', { name: place.section }))
      return layers.getByRole('region', { name: place.section })
    }
    case 'popover':
      await openButton(page.getByRole('button', { name: place.title, exact: true }))
      return page.getByRole('dialog', { name: place.title })
    case 'embedding': {
      const cells = await openControls(page, 'genes')
      const show = cells.getByRole('button', { name: 'Show Embedding' })
      if ((await show.count()) > 0) await show.click()
      return page.getByRole('region', { name: 'Embedding' })
    }
    case 'none':
      return page.locator('main')
  }
}

function infoButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Dataset info/ })
}

async function isExpanded(button: Locator): Promise<boolean> {
  return (await button.getAttribute('aria-expanded')) === 'true'
}

async function openButton(button: Locator): Promise<void> {
  if (!(await isExpanded(button))) await button.click()
}

async function closeButton(button: Locator): Promise<void> {
  if (await isExpanded(button)) await button.click()
}

// Waits for an activity log entry. The log is collapsed by default (15.1-H),
// so this opens it first, as a user would.
export async function expectLogEntry(
  page: Page,
  text: RegExp,
  options: { readonly timeout?: number } = {},
): Promise<void> {
  await openControls(page, 'diagnostics')
  const log = page.getByRole('region', { name: 'Activity log' })
  const details = log.locator('details')

  if ((await details.getAttribute('open')) === null) {
    await log.locator('summary').click()
  }

  await expect(log.getByText(text)).toBeVisible(options)
}
