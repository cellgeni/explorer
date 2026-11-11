import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

// Where the start screen reads its example gallery (UNIFIED_PLAN.md, 15.3-A).
export const EXAMPLES_INDEX_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'

// Answers the gallery's request with this checkout's examples/index.json, so
// tests never depend on GitHub.
export async function routeLocalExamplesIndex(page: Page): Promise<void> {
  await page.route(EXAMPLES_INDEX_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: readFileSync(join(process.cwd(), 'examples', 'index.json'), 'utf8'),
    }),
  )
}

// As if GitHub could not be reached. Routes registered later win, so this
// overrides routeLocalExamplesIndex.
export async function failExamplesIndex(page: Page): Promise<void> {
  await page.route(EXAMPLES_INDEX_URL, (route) => route.abort('failed'))
}
