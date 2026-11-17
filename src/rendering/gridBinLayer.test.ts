import type { GetPickingInfoParams, PickingInfo } from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import { GridBinLayer } from './gridBinLayer'

function pick(layer: GridBinLayer<{ readonly id: string }>, index: number): PickingInfo {
  return layer.getPickingInfo({
    info: { index, object: null } as unknown as PickingInfo,
    mode: 'hover',
    sourceLayer: layer,
  } as GetPickingInfoParams)
}

describe('GridBinLayer', () => {
  it('builds the picked bin from packed data', () => {
    const layer = new GridBinLayer<{ readonly id: string }>({
      id: 'bins',
      data: { length: 2, attributes: {} } as unknown as { readonly id: string }[],
      pickObject: (index) => ({ id: `bin-${index}` }),
    })

    expect(pick(layer, 1).object).toEqual({ id: 'bin-1' })
    // Nothing under the pointer.
    expect(pick(layer, -1).object).toBeNull()
  })

  it('picks from array data without pickObject', () => {
    const layer = new GridBinLayer<{ readonly id: string }>({
      id: 'bins',
      data: [{ id: 'a' }, { id: 'b' }],
    })

    expect(pick(layer, 1).object).toEqual({ id: 'b' })
  })
})
