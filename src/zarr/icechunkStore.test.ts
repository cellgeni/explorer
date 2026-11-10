import * as zarr from 'zarrita'
import { describe, expect, it } from 'vitest'
import {
  ICECHUNK_FIXTURE_ORIGIN,
  icechunkFixtureFetcher,
  type IcechunkFixtureRequest,
} from '../test/icechunkFixtures'
import { openIcechunkRepository } from './icechunkStore'
import { icechunkCompanionFileUrl, isIcechunkUrl } from './icechunkUrl'

const TINY_X_DATA = [1, 5, 2, 3, 4, 6, 1, 7, 8, 2, 3, 1]

describe('openIcechunkRepository', () => {
  it('lists every node and its metadata from the snapshot', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const repository = await openIcechunkRepository(
      `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk/`,
      { fetcher: icechunkFixtureFetcher({ requests }) },
    )

    expect(repository.url).toBe(`${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`)
    expect(repository.rootAttributes).toMatchObject({ 'encoding-type': 'anndata' })
    expect(repository.nodes[0]).toEqual({ path: '', kind: 'group' })
    expect(repository.nodes).toContainEqual({ path: 'X', kind: 'group' })
    expect(repository.nodes).toContainEqual({ path: 'X/data', kind: 'array' })
    expect(repository.nodes).toContainEqual({ path: 'obsm/spatial', kind: 'array' })
    expect(repository.metadata.get('/X/data/zarr.json')).toMatchObject({
      node_type: 'array',
      shape: [12],
    })
    // The repo file and one snapshot; no listing or per-node metadata.
    expect(requests.map((request) => request.path)).toEqual([
      '/anndata.icechunk/repo',
      expect.stringMatching(/^\/anndata\.icechunk\/snapshots\//),
    ])

    const data = await zarr.get(
      await zarr.open.v3(zarr.root(repository.store).resolve('X/data'), {
        kind: 'array',
      }),
    )
    expect(Array.from(data.data as Float32Array)).toEqual(TINY_X_DATA)
  })

  it('reads virtual chunks from the locations the repository stores', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const repository = await openIcechunkRepository(
      `${ICECHUNK_FIXTURE_ORIGIN}/copy.icechunk`,
      {
        fetcher: icechunkFixtureFetcher({
          aliases: { '/copy.icechunk': '/tiny.h5ad.icechunk' },
          requests,
        }),
      },
    )
    const data = await zarr.get(
      await zarr.open.v3(zarr.root(repository.store).resolve('X/data'), {
        kind: 'array',
      }),
    )

    expect(Array.from(data.data as Float32Array)).toEqual(TINY_X_DATA)
    expect(requests).toContainEqual({
      method: 'GET',
      path: '/tiny.h5ad',
      range: expect.stringMatching(/^bytes=\d+-\d+$/),
    })
  })

  it('reads virtual chunks from virtualChunkUrl when given', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const repository = await openIcechunkRepository(
      `${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad.icechunk`,
      {
        fetcher: icechunkFixtureFetcher({
          aliases: { '/moved.h5ad': '/tiny.h5ad' },
          requests,
        }),
        virtualChunkUrl: `${ICECHUNK_FIXTURE_ORIGIN}/moved.h5ad?token=abc`,
      },
    )
    const indices = await zarr.get(
      await zarr.open.v3(zarr.root(repository.store).resolve('X/indices'), {
        kind: 'array',
      }),
    )

    expect(Array.from(indices.data as Int32Array)).toEqual([
      0, 2, 0, 1, 1, 2, 3, 0, 2, 3, 0, 1,
    ])
    expect(requests.some((request) => request.path === '/tiny.h5ad')).toBe(false)
    expect(requests).toContainEqual(expect.objectContaining({ path: '/moved.h5ad' }))
  })

  it('reads from hosts that ignore Range', async () => {
    const repository = await openIcechunkRepository(
      `${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad.icechunk`,
      { fetcher: icechunkFixtureFetcher({ ignoreRange: true }) },
    )
    const data = await zarr.get(
      await zarr.open.v3(zarr.root(repository.store).resolve('X/data'), {
        kind: 'array',
      }),
    )

    expect(Array.from(data.data as Float32Array)).toEqual(TINY_X_DATA)
  })

  it('reports a missing repository on hosts that answer 403 for missing objects', async () => {
    await expect(
      openIcechunkRepository(`${ICECHUNK_FIXTURE_ORIGIN}/missing.icechunk`, {
        fetcher: icechunkFixtureFetcher({ missingStatus: 403 }),
      }),
    ).rejects.toMatchObject({
      name: 'IcechunkRepositoryUnavailableError',
      found: false,
      message: expect.stringContaining(
        `No readable Icechunk repository at ${ICECHUNK_FIXTURE_ORIGIN}/missing.icechunk`,
      ),
    })
  })

  it('reuses a repository opened with the same fetcher', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const fetcher = icechunkFixtureFetcher({ requests })
    const url = `${ICECHUNK_FIXTURE_ORIGIN}/image.icechunk`
    const first = await openIcechunkRepository(url, { fetcher })

    await expect(openIcechunkRepository(`${url}/`, { fetcher })).resolves.toBe(first)
    await expect(
      openIcechunkRepository(url, { fetcher: icechunkFixtureFetcher() }),
    ).resolves.not.toBe(first)
    expect(requests.filter((request) => request.path.endsWith('/repo'))).toHaveLength(1)
  })

  it('prefetches manifests once, for arrays only', async () => {
    const requests: IcechunkFixtureRequest[] = []
    const repository = await openIcechunkRepository(
      `${ICECHUNK_FIXTURE_ORIGIN}/tiny.h5ad.icechunk`,
      { fetcher: icechunkFixtureFetcher({ requests }) },
    )
    const manifestRequests = () =>
      requests.filter((request) => request.path.includes('/manifests/'))

    repository.prefetchManifests(['X/data', 'X/indices', 'X', 'obs/missing'])
    repository.prefetchManifests(['X/data'])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(manifestRequests()).toHaveLength(2)

    for (const path of ['X/data', 'X/indices']) {
      await zarr.get(
        await zarr.open.v3(zarr.root(repository.store).resolve(path), { kind: 'array' }),
      )
    }

    expect(manifestRequests()).toHaveLength(2)
  })
})

describe('Icechunk URLs', () => {
  it('recognises repositories by suffix', () => {
    expect(isIcechunkUrl('https://example.test/data.icechunk')).toBe(true)
    expect(isIcechunkUrl('https://example.test/data.icechunk/?token=1')).toBe(true)
    expect(isIcechunkUrl('https://example.test/data.icechunk/repo')).toBe(false)
    expect(isIcechunkUrl('https://example.test/data.zarr')).toBe(false)
  })

  it('names the H5AD of a companion repository', () => {
    expect(
      icechunkCompanionFileUrl('https://example.test/a/sample.h5ad.icechunk/?token=1#x'),
    ).toBe('https://example.test/a/sample.h5ad?token=1')
    expect(icechunkCompanionFileUrl('https://example.test/data.icechunk')).toBeUndefined()
  })
})
