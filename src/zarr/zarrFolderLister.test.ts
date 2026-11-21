import { describe, expect, it } from 'vitest'
import { createZarrFolderLister } from './zarrFolderLister'

describe('Zarr folder listings', () => {
  it('reads the index page of a folder whose name holds %, # and ?', async () => {
    const urls: string[] = []
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      urls.push(request.url)

      // No S3 listing, so the lister falls back to index pages.
      return new URL(request.url).searchParams.has('list-type')
        ? new Response(null, { status: 404 })
        : new Response(
            '<title>Index of /s.zarr/obs/</title><a href="0">0</a><a href=".zarray">.zarray</a>',
            { headers: { 'Content-Type': 'text/html' } },
          )
    }) as typeof fetch
    const lister = createZarrFolderLister('https://example.test/s.zarr', fetcher)

    await expect(lister.list('obs/% mito #1?')).resolves.toMatchObject({
      files: expect.arrayContaining([{ name: '0' }]),
    })
    expect(urls.at(-1)).toBe('https://example.test/s.zarr/obs/%25%20mito%20%231%3F/')
  })
})
