import { describe, expect, it } from 'vitest'
import { folderFileUrl, pathInFolder } from './folderUrl'

describe('folderFileUrl', () => {
  it('appends the path to a plain folder', () => {
    expect(folderFileUrl('https://h.test/run', 'spatial/a.csv')).toBe(
      'https://h.test/run/spatial/a.csv',
    )
    expect(folderFileUrl('https://h.test/run//', '/a.csv')).toBe(
      'https://h.test/run/a.csv',
    )
  })

  it('puts the path before the query and keeps the query', () => {
    expect(folderFileUrl('https://h.test/run?token=abc', 'experiment.xenium')).toBe(
      'https://h.test/run/experiment.xenium?token=abc',
    )
    expect(folderFileUrl('https://h.test/run/?sv=1&sig=a%2Fb', 'cells.parquet')).toBe(
      'https://h.test/run/cells.parquet?sv=1&sig=a%2Fb',
    )
  })

  it('drops the fragment', () => {
    expect(folderFileUrl('https://h.test/run#notes', 'a.csv')).toBe(
      'https://h.test/run/a.csv',
    )
    expect(folderFileUrl('https://h.test/run?x=1#notes?y', 'a.csv')).toBe(
      'https://h.test/run/a.csv?x=1',
    )
  })

  it('gives the folder with a trailing slash for an empty path', () => {
    expect(folderFileUrl('https://h.test/run?x=1', '')).toBe('https://h.test/run/?x=1')
  })

  it('finds the path again', () => {
    const folder = 'https://h.test/run/?token=abc#notes'

    expect(pathInFolder(folder, folderFileUrl(folder, 'outs/cells.parquet'))).toBe(
      'outs/cells.parquet',
    )
    expect(pathInFolder(folder, 'https://h.test/other/cells.parquet?token=abc')).toBe(
      undefined,
    )
    expect(pathInFolder('https://h.test/run', 'https://h.test/run/a.csv')).toBe('a.csv')
  })
})
