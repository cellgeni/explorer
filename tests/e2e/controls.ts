import { expect, type Locator, type Page } from '@playwright/test'
import { CONTROL_AREAS, type ControlArea } from '../../src/test/controlAreas'

// Shows the controls for an area (see src/test/controlAreas.ts) and returns
// the element that holds them: the start screen or the dataset menu, the info
// drawer, a layer section, a popover, or the Embedding, Plots, Cell Query or
// Python window, opened unless it already is. Under 860 px it expands the
// layer sheet for a section and picks a window from the Panels menu.
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
      await openButton(datasetMenuButton(page))
      return page.getByRole('dialog', { name: 'Open dataset' })
    }
    case 'info-drawer':
      await closeButton(datasetMenuButton(page))
      await openButton(infoButton(page))
      return page.getByRole('dialog', { name: 'Dataset info' })
    case 'section': {
      const layers = page.getByRole('complementary', { name: 'Layers' })
      // The sheet's handle is named "Layers" and what the sheet shows.
      if (isNarrow(page)) {
        await openButton(layers.getByRole('button', { name: /^Layers/ }))
      }
      await openButton(layers.getByRole('button', { name: place.section }))
      return layers.getByRole('region', { name: place.section })
    }
    case 'popover':
      await openButton(page.getByRole('button', { name: place.title, exact: true }))
      return page.getByRole('dialog', { name: place.title })
    case 'panel': {
      const window = page.getByRole('region', { name: place.window })
      if (isNarrow(page)) {
        // A menu, closed by picking a toggle; one window shows at a time.
        const menu = panelMenuButton(page)
        await openButton(menu)
        const toggle = page
          .getByRole('dialog', { name: 'Panels' })
          .getByRole('button', { name: place.name, exact: true })
        if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
        else await closeButton(menu)
        return window
      }
      const toggle = page
        .getByRole('group', { name: 'Panels' })
        .getByRole('button', { name: place.name, exact: true })
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
      return window
    }
    case 'none':
      return page.locator('main')
  }
}

// The layout under 860 px (NARROW_SCREEN_QUERY in
// src/features/shell/useNarrowScreen.ts), from the page's viewport.
export function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? Infinity) < 860
}

// Under 860 px, the top bar's menu of window toggles.
export function panelMenuButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Panels', exact: true })
}

// The top bar's dataset name, which opens the dataset menu. Its accessible
// name is the file name, so it is found by its title, exactly: each Activity
// log entry has its message as a title, and "Cancelled loading …; the open
// dataset stays" holds "open dataset".
function datasetMenuButton(page: Page): Locator {
  return page.getByTitle('Open dataset', { exact: true })
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
