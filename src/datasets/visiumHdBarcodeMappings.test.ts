import { describe, expect, it } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import {
  VISIUM_HD_BARCODE_MAPPING_COLUMNS,
  VisiumHdBarcodeMappingsBudgetExceededError,
  parseVisiumHdBarcodeMappingRows,
  readVisiumHdBarcodeMappings,
  selectVisiumHdBarcodeMappingAssignments,
} from './visiumHdBarcodeMappings'
import type { AsyncBuffer } from 'hyparquet'
import type { VisiumHdBarcodeMappingsReadObjectsOptions } from './visiumHdBarcodeMappings'

const fakeFile: AsyncBuffer = {
  byteLength: 8,
  slice: () => new ArrayBuffer(0),
}

describe('Visium HD barcode mappings', () => {
  it('projects root barcode_mappings.parquet columns through a budgeted read', async () => {
    const calls: VisiumHdBarcodeMappingsReadObjectsOptions[] = []
    const mappings = await readVisiumHdBarcodeMappings('https://example.test/visium', {
      file: fakeFile,
      maxRows: 10,
      readObjects: async (options) => {
        calls.push(options)
        return [
          {
            square_002um: 's_002um_000001_000002-1',
            square_008um: 's_008um_000000_000000-1',
            square_016um: 's_016um_000000_000000-1',
            cell_id: 'cell-1',
            in_nucleus: 1n,
            in_cell: true,
          },
        ]
      },
    })

    expect(calls).toEqual([
      {
        file: fakeFile,
        columns: VISIUM_HD_BARCODE_MAPPING_COLUMNS,
        rowFormat: 'object',
        rowEnd: 11,
        compressors: parquetCompressors,
      },
    ])
    expect(mappings).toEqual([
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: 'cell-1',
        inNucleus: true,
        inCell: true,
      },
    ])
  })

  it('rejects reads that return more rows than the configured budget', async () => {
    await expect(
      readVisiumHdBarcodeMappings('https://example.test/visium', {
        file: fakeFile,
        maxRows: 1,
        readObjects: async () => [
          mappingRow('s_002um_000001_000002-1'),
          mappingRow('s_002um_000003_000004-1'),
        ],
      }),
    ).rejects.toBeInstanceOf(VisiumHdBarcodeMappingsBudgetExceededError)
  })

  it('normalizes nullable cell ids and numeric cell flags', () => {
    expect(
      parseVisiumHdBarcodeMappingRows(
        [
          {
            ...mappingRow('s_002um_000001_000002-1'),
            cell_id: null,
            in_nucleus: 0,
            in_cell: 1,
          },
        ],
        { maxRows: 1 },
      ),
    ).toEqual([
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: null,
        inNucleus: false,
        inCell: true,
      },
    ])
  })

  it('rejects barcode columns that do not match the expected tier', () => {
    expect(() =>
      parseVisiumHdBarcodeMappingRows(
        [
          {
            ...mappingRow('s_008um_000001_000002-1'),
          },
        ],
        { maxRows: 1 },
      ),
    ).toThrow('Expected barcode_mappings.parquet square_002um')
  })

  it('selects cell assignments for a requested binned tier', () => {
    const mappings = parseVisiumHdBarcodeMappingRows(
      [
        {
          square_002um: 's_002um_000001_000002-1',
          square_008um: 's_008um_000000_000000-1',
          square_016um: 's_016um_000000_000000-1',
          cell_id: 'cell-a',
          in_nucleus: true,
          in_cell: true,
        },
        {
          square_002um: 's_002um_000003_000004-1',
          square_008um: 's_008um_000000_000001-1',
          square_016um: 's_016um_000000_000000-1',
          cell_id: null,
          in_nucleus: false,
          in_cell: false,
        },
      ],
      { maxRows: 2 },
    )

    expect(
      selectVisiumHdBarcodeMappingAssignments(mappings, 16, ['s_016um_000000_000000-1']),
    ).toEqual([
      {
        binId: 's_016um_000000_000000-1',
        square002um: 's_002um_000001_000002-1',
        cellId: 'cell-a',
        inNucleus: true,
        inCell: true,
      },
      {
        binId: 's_016um_000000_000000-1',
        square002um: 's_002um_000003_000004-1',
        cellId: null,
        inNucleus: false,
        inCell: false,
      },
    ])
  })
})

function mappingRow(square002um: string): Record<string, unknown> {
  return {
    square_002um: square002um,
    square_008um: 's_008um_000000_000000-1',
    square_016um: 's_016um_000000_000000-1',
    cell_id: 'cell-1',
    in_nucleus: false,
    in_cell: true,
  }
}
