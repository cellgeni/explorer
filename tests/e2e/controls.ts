import { expect, type Locator, type Page } from '@playwright/test'
import { CONTROL_AREA_TABS, type ControlArea } from '../../src/test/controlAreas'

// Shows the controls for an area (see src/test/controlAreas.ts) and returns
// the element that holds them. Today this selects the Control HUD tab, unless
// it is already selected, and returns its panel.
export async function openControls(page: Page, area: ControlArea): Promise<Locator> {
  const tabId = CONTROL_AREA_TABS[area]
  const tab = page.locator(`#hud-tab-${tabId}`)
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  return page.locator(`#hud-panel-${tabId}`)
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
