import type { Locator, Page } from '@playwright/test'
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
