import { describe, expect, it } from 'vitest'
import {
  MerscopeFormatError,
  merscopeTable,
  merscopeTableTransferables,
  parseMerscopeCellByGene,
  parseMerscopeCellMetadata,
} from './merscopeFormat'

// Headers trimmed from public deposits: the instrument's (BIA S-BIAD3359),
// vpt Baysor's (S-BIAD2376, empty fov), and the 2022 release's (Zenodo
// 11160289: unnamed ID column, counts written as 0.0, min/max in another
// order). The first two IDs are the same number as a double.
const ID_A = '1577590100000000000'
const ID_B = '1577590100000000001'
const ID_C = '1577590100000000002'
const LONG_ID = '158338042824236264719696604356349910479'

function csv(...lines: string[]): string {
  return `${lines.join('\n')}\n`
}

describe('MERSCOPE cell_by_gene.csv', () => {
  it('keeps 19-digit cell IDs as strings and sums Blank columns per cell', () => {
    const counts = parseMerscopeCellByGene(
      csv(
        'cell,CD4,SNAI2,Blank-0,Blank-1',
        `${ID_A},3,0,0,1`,
        `${ID_B},0,5,2,0`,
        `${ID_C},0,0,0,0`,
      ),
    )

    expect(counts.ids).toEqual([ID_A, ID_B, ID_C])
    expect(counts.genes).toEqual(['CD4', 'SNAI2'])
    expect(counts.blankColumnCount).toBe(2)
    expect(Array.from(counts.data)).toEqual([3, 5])
    expect(Array.from(counts.indices)).toEqual([0, 1])
    expect(Array.from(counts.indptr)).toEqual([0, 1, 2, 2])
    expect(Array.from(counts.totalCounts)).toEqual([3, 5, 0])
    expect(Array.from(counts.blankCounts ?? [])).toEqual([1, 2, 0])
  })

  it('reads an unnamed ID column, 38-digit IDs, 0.0 counts, and CRLF lines', () => {
    const counts = parseMerscopeCellByGene(
      `,Oxt,Blank-1\r\n${LONG_ID},2.0,0.0\r\n${LONG_ID}1,0.0,1.0\r\n`,
    )

    expect(counts.ids).toEqual([LONG_ID, `${LONG_ID}1`])
    expect(counts.genes).toEqual(['Oxt'])
    expect(Array.from(counts.data)).toEqual([2])
    expect(Array.from(counts.indptr)).toEqual([0, 1, 1])
    expect(Array.from(counts.blankCounts ?? [])).toEqual([0, 1])
  })

  it('has no Blank counts without Blank columns', () => {
    expect(parseMerscopeCellByGene(csv('cell,CD4', `${ID_A},1`)).blankCounts).toBeNull()
  })

  it('reports rows that do not match the header', () => {
    expect(() =>
      parseMerscopeCellByGene(csv('cell,CD4,SNAI2', `${ID_A},1,0`, `${ID_B},1`)),
    ).toThrow('cell_by_gene.csv row 2 has 2 fields; the header has 3.')
    expect(() => parseMerscopeCellByGene(csv('cell,CD4', `${ID_A},x`))).toThrow(
      'a count that is not a number ("x")',
    )
    expect(() => parseMerscopeCellByGene(csv('cell,Blank-0', `${ID_A},1`))).toThrow(
      MerscopeFormatError,
    )
  })
})

describe('MERSCOPE cell_metadata.csv', () => {
  it('reads numeric columns, with NaN for empty values', () => {
    const metadata = parseMerscopeCellMetadata(
      csv(
        'EntityID,fov,volume,center_x,center_y',
        `${ID_A},,473.7,13897.2,6276.8`,
        `${ID_B},,232.5,12753.9,5693.2`,
      ),
    )

    expect(metadata.ids).toEqual([ID_A, ID_B])
    expect(metadata.columns.map((column) => [column.name, column.kind])).toEqual([
      ['fov', 'numeric'],
      ['volume', 'numeric'],
      ['center_x', 'numeric'],
      ['center_y', 'numeric'],
    ])
    expect(metadata.columns[0]?.values).toEqual(new Float64Array([NaN, NaN]))
    expect(metadata.columns[1]?.values).toEqual(new Float64Array([473.7, 232.5]))
  })

  it('reads a column as text from its first value that is not a number', () => {
    const metadata = parseMerscopeCellMetadata(
      csv('EntityID,cell_type', `${ID_A},12`, `${ID_B},T cell`, `${ID_C},`),
    )

    expect(metadata.columns[0]).toEqual({
      name: 'cell_type',
      kind: 'text',
      values: ['12', 'T cell', ''],
    })
  })
})

describe('MERSCOPE table', () => {
  const counts = parseMerscopeCellByGene(
    csv('cell,CD4,SNAI2,Blank-0', `${ID_A},3,0,1`, `${ID_B},0,5,0`, `${ID_C},1,1,0`),
  )

  it('joins the files by ID, keeps cell_by_gene order, and counts cells in one file', () => {
    const table = merscopeTable(
      counts,
      parseMerscopeCellMetadata(
        csv(
          'EntityID,fov,volume,center_x,center_y,min_x,min_y,max_x,max_y,transcript_count',
          `${ID_C},13,200,1020,2030,1016,2026,1024,2034,2`,
          `${ID_A},12,500.5,1010,2010,1006,2006,1014,2014,4`,
          `1577590100000000099,12,1,1,1,1,1,1,1,1`,
        ),
      ),
    )

    expect(table.ids).toEqual([ID_A, ID_C])
    expect(table.countsOnlyCells).toBe(1)
    expect(table.metadataOnlyCells).toBe(1)
    expect(Array.from(table.spatial)).toEqual([1010, 2010, 1020, 2030])
    expect(Array.from(table.data)).toEqual([3, 1, 1])
    expect(Array.from(table.indices)).toEqual([0, 0, 1])
    expect(Array.from(table.indptr)).toEqual([0, 1, 3])
    // Positions are not tracks; fov is a category.
    expect(table.obs.map((column) => column.name)).toEqual([
      'fov',
      'volume',
      'transcript_count',
      'total_counts',
      'blank_count',
    ])
    expect(table.obs[0]).toEqual({
      name: 'fov',
      kind: 'categorical',
      codes: new Int32Array([0, 1]),
      categories: ['12', '13'],
    })
    expect(table.obs.find((column) => column.name === 'blank_count')).toEqual({
      name: 'blank_count',
      kind: 'numeric',
      values: new Float64Array([1, 0]),
    })
  })

  it('reuses the matrix when both files list the same cells in order', () => {
    const table = merscopeTable(
      counts,
      parseMerscopeCellMetadata(
        csv(
          ',fov,volume,center_x,center_y,min_x,max_x,min_y,max_y',
          `${ID_A},,1,1,1,0,2,0,2`,
          `${ID_B},,1,2,2,1,3,1,3`,
          `${ID_C},,1,3,3,2,4,2,4`,
        ),
      ),
    )

    expect(table.data).toBe(counts.data)
    expect(table.emptyColumns).toEqual(['fov'])
    expect(table.countsOnlyCells + table.metadataOnlyCells).toBe(0)
    expect(merscopeTableTransferables(table)).toContain(table.data.buffer)
  })

  it('needs cell centres and at least one shared cell', () => {
    expect(() =>
      merscopeTable(
        counts,
        parseMerscopeCellMetadata(csv('EntityID,volume', `${ID_A},1`)),
      ),
    ).toThrow('has no numeric center_x and center_y columns')
    expect(() =>
      merscopeTable(
        counts,
        parseMerscopeCellMetadata(csv('EntityID,center_x,center_y', '42,1,1')),
      ),
    ).toThrow('None of the cell_by_gene.csv cell IDs are in cell_metadata.csv.')
  })
})
