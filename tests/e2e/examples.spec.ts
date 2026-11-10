import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// Loads every example in examples/index.json through its README link. The
// manifest requests to raw.githubusercontent.com are answered from this
// checkout, so a branch is tested with its own manifests; the data still comes
// from the repositories, so these run only in the nightly live job.

interface ExampleEntry {
  readonly id: string
  readonly path: string
  readonly manifestUrl: string
  readonly name: string
}

const EXAMPLE_LOAD_TIMEOUT_MS = 180_000
const examplesDir = join(process.cwd(), 'examples')
const { examples } = JSON.parse(
  readFileSync(join(examplesDir, 'index.json'), 'utf8'),
) as { readonly examples: readonly ExampleEntry[] }

for (const example of examples) {
  test(`loads the ${example.id} example @live`, async ({ page }) => {
    test.setTimeout(EXAMPLE_LOAD_TIMEOUT_MS + 30_000)

    await page.route(example.manifestUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: readFileSync(join(examplesDir, example.path), 'utf8'),
      }),
    )
    await page.goto(`/?dataset=${encodeURIComponent(example.manifestUrl)}`)

    await expect(
      page.getByText(/(?:Dataset|Atera|H5AD|SpatialData|Image|Visium HD|Visium) ready: /),
    ).toBeVisible({ timeout: EXAMPLE_LOAD_TIMEOUT_MS })
    await expect(page.getByRole('region', { name: 'About this dataset' })).toContainText(
      example.name,
    )
    await expect(page.getByRole('alert', { name: 'Load issues' })).toHaveCount(0)
  })
}
