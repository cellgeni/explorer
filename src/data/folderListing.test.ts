import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearFolderListings,
  fileNotListedError,
  isListedAsMissing,
  parseFolderListing,
  readFolderListing,
  setFolderListing,
} from './folderListing'

const FOLDER = 'https://ftp.example.test/biostudies/S-TEST/xenium/run-1'

// Trimmed from the Apache index page ftp.ebi.ac.uk serves.
const APACHE_INDEX = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html>
 <head>
  <title>Index of /biostudies/S-TEST/xenium/run-1</title>
 </head>
 <body>
<h1>Index of /biostudies/S-TEST/xenium/run-1</h1>
  <table>
   <tr><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th></tr>
<tr><td><a href="/biostudies/S-TEST/xenium/">Parent Directory</a></td></tr>
<tr><td><a href="analysis.zarr.zip">analysis.zarr.zip</a></td></tr>
<tr><td><a href="cells.parquet">cells.parquet</a></td></tr>
<tr><td><a href="experiment.xenium">experiment.xenium</a></td></tr>
<tr><td><a href="morphology.ome.tif">morphology.ome.tif</a></td></tr>
<tr><td><a href="aux%20outputs/">aux outputs/</a></td></tr>
<tr><td><a href="https://elsewhere.example.test/cells.parquet">mirror</a></td></tr>
</table>
</body></html>`

afterEach(() => {
  clearFolderListings()
})

describe('folder index pages', () => {
  it('lists the direct children of an Apache index page', () => {
    const listing = parseFolderListing(APACHE_INDEX, FOLDER)

    expect(listing).toEqual({
      folderUrl: `${FOLDER}/`,
      names: new Set([
        'analysis.zarr.zip',
        'cells.parquet',
        'experiment.xenium',
        'morphology.ome.tif',
        'aux outputs/',
      ]),
      listsDotfiles: false,
    })
  })

  it('reads nginx and Python http.server index pages', () => {
    const nginx = `<html><head><title>Index of /data/run-1/</title></head><body>
<h1>Index of /data/run-1/</h1><hr><pre><a href="../">../</a>
<a href="cells.parquet">cells.parquet</a>   09-Nov-2026 10:00   449K
<a href=".zchunkstore">.zchunkstore</a>   09-Nov-2026 10:00   1K
</pre><hr></body></html>`
    const python = `<html><head><title>Directory listing for /run-1/</title></head>
<body><ul><li><a href="cells.parquet">cells.parquet</a></li>
<li><a href='morphology_focus/'>morphology_focus/</a></li></ul></body></html>`

    expect(parseFolderListing(nginx, 'https://host.test/data/run-1/')).toMatchObject({
      names: new Set(['cells.parquet', '.zchunkstore']),
      listsDotfiles: true,
    })
    expect(parseFolderListing(python, 'https://host.test/run-1')).toMatchObject({
      names: new Set(['cells.parquet', 'morphology_focus/']),
    })
  })

  it('ignores HTML that is not an index page, and index pages with no entries', () => {
    expect(
      parseFolderListing(
        '<html><head><title>viewer</title></head><body><a href="cells.parquet">x</a></body></html>',
        FOLDER,
      ),
    ).toBeNull()
    expect(
      parseFolderListing(
        '<html><head><title>Index of /run-1</title></head><body></body></html>',
        FOLDER,
      ),
    ).toBeNull()
  })

  it('reads the index page at the folder URL with a trailing slash', async () => {
    const fetcher = vi.fn(async () => new Response(APACHE_INDEX, { status: 200 }))

    await expect(
      readFolderListing(FOLDER, { fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toMatchObject({ folderUrl: `${FOLDER}/` })
    expect(fetcher).toHaveBeenCalledWith(
      `${FOLDER}/`,
      expect.objectContaining({ cache: 'no-cache' }),
    )
  })

  it('returns null when the host serves no readable index page', async () => {
    const notFound = vi.fn(async () => new Response('missing', { status: 404 }))
    const failed = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      readFolderListing(FOLDER, { fetcher: notFound as unknown as typeof fetch }),
    ).resolves.toBeNull()
    await expect(
      readFolderListing(FOLDER, { fetcher: failed as unknown as typeof fetch }),
    ).resolves.toBeNull()
  })

  it('rethrows when the caller aborts', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    const fetcher = vi.fn(async () => {
      controller.abort(abortError)
      throw abortError
    })

    await expect(
      readFolderListing(FOLDER, {
        fetcher: fetcher as unknown as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError)
  })
})

describe('missing files', () => {
  it('rules out files and folders the registered index page does not list', () => {
    setFolderListing(FOLDER, parseFolderListing(APACHE_INDEX, FOLDER))

    expect(isListedAsMissing(`${FOLDER}/cells.parquet`)).toBe(false)
    expect(isListedAsMissing(`${FOLDER}/aux%20outputs/cells.csv`)).toBe(false)
    expect(isListedAsMissing(`${FOLDER}/explorer.json`)).toBe(true)
    expect(
      isListedAsMissing(`${FOLDER}/morphology_focus/morphology_focus_0000.ome.tif`),
    ).toBe(true)
    // A listed file is not a folder.
    expect(isListedAsMissing(`${FOLDER}/cells.parquet/part-0`)).toBe(true)
  })

  it('does not rule out dotfiles, which index pages usually hide', () => {
    setFolderListing(FOLDER, parseFolderListing(APACHE_INDEX, FOLDER))

    expect(isListedAsMissing(`${FOLDER}/.zchunkstore`)).toBe(false)
  })

  it('does not rule out files outside the registered folders', () => {
    setFolderListing(FOLDER, parseFolderListing(APACHE_INDEX, FOLDER))

    expect(
      isListedAsMissing('https://ftp.example.test/biostudies/S-TEST/other.tif'),
    ).toBe(false)
    expect(isListedAsMissing('https://other.example.test/explorer.json')).toBe(false)
  })

  it('forgets a folder whose index page is no longer readable', () => {
    setFolderListing(FOLDER, parseFolderListing(APACHE_INDEX, FOLDER))
    setFolderListing(`${FOLDER}/`, null)

    expect(isListedAsMissing(`${FOLDER}/explorer.json`)).toBe(false)
  })

  it('describes an unlisted file as not found', () => {
    setFolderListing(FOLDER, parseFolderListing(APACHE_INDEX, FOLDER))

    expect(fileNotListedError('cells.parquet', `${FOLDER}/cells.parquet`)).toBeUndefined()
    expect(
      fileNotListedError('transcripts.parquet', `${FOLDER}/transcripts.parquet`),
    ).toMatchObject({
      name: 'FileNotListedError',
      message: `transcripts.parquet was not found. ${FOLDER}/transcripts.parquet is not in the folder listing of ${FOLDER}/. Check that the file exists at this path.`,
    })
  })
})
