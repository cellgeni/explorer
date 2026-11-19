import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectLogEntry } from './controls'

// Loads every example in examples/index.json through its README link. The
// manifest and collection requests to raw.githubusercontent.com are answered
// from this checkout, so a branch is tested with its own manifests; the data
// still comes from the repositories, so these run only in the nightly live job.

interface ExampleEntry {
  readonly id: string
  readonly path: string
  // A collection has a collectionUrl instead, and opens its first dataset.
  readonly manifestUrl?: string
  readonly collectionUrl?: string
  readonly name: string
}

const EXAMPLE_LOAD_TIMEOUT_MS = 180_000
const RAW_EXAMPLES_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/'
const examplesDir = join(process.cwd(), 'examples')
const { examples } = JSON.parse(
  readFileSync(join(examplesDir, 'index.json'), 'utf8'),
) as { readonly examples: readonly ExampleEntry[] }

// The checkout's file for a raw GitHub URL, or null where GitHub answers 404,
// as it does for a folder.
function exampleFile(url: string): string | null {
  const path = new URL(url).pathname.slice(new URL(RAW_EXAMPLES_URL).pathname.length)
  const file = join(examplesDir, decodeURIComponent(path))
  return existsSync(file) && statSync(file).isFile() ? file : null
}

for (const example of examples) {
  test(`loads the ${example.id} example @live`, async ({ page }) => {
    test.setTimeout(EXAMPLE_LOAD_TIMEOUT_MS + 30_000)

    // The example, and a collection's dataset manifests beside it.
    await page.route(`${RAW_EXAMPLES_URL}**`, (route) => {
      const file = exampleFile(route.request().url())
      return route.fulfill({
        status: file === null ? 404 : 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: file === null ? '' : readFileSync(file, 'utf8'),
      })
    })
    await page.goto(
      example.collectionUrl === undefined
        ? `/?dataset=${encodeURIComponent(example.manifestUrl ?? '')}`
        : `/?collection=${encodeURIComponent(example.collectionUrl)}`,
    )

    await expectLogEntry(
      page,
      /(?:Dataset|Atera|H5AD|SpatialData|Image|Visium HD|Visium|MERSCOPE) ready: /,
      { timeout: EXAMPLE_LOAD_TIMEOUT_MS },
    )
    await expect(
      example.collectionUrl === undefined
        ? page.getByRole('region', { name: 'About this dataset' })
        : page.getByRole('navigation', { name: 'Collection' }),
    ).toContainText(example.name)
    await expect(page.getByRole('alert', { name: 'Load issues' })).toHaveCount(0)
  })
}

// The start screen reads the gallery from GitHub at runtime (plan 15.3-A, D9);
// smoke tests answer that request locally, so this one checks the real index.
test('lists the examples from GitHub on the start screen @live', async ({ page }) => {
  await page.goto('/')

  const start = page.getByRole('region', { name: 'Open a dataset' })
  await expect(
    start.getByRole('list', { name: 'Examples' }).getByRole('link').first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(start).not.toContainText("Examples couldn't be loaded")
})
