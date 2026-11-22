import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { plotTestInput } from '../../test/plotFixtures'
import { testPlotsModel } from '../../test/sectionModels'
import { dotPlotModel } from './dotPlot'
import { PlotsPanel } from './PlotsPanel'
import * as plotViews from './plotViews'
import type { PlotView } from './plotViews'

vi.mock('./plotViews', async (importOriginal) => {
  const original = await importOriginal<typeof import('./plotViews')>()
  return {
    ...original,
    plotViewSvg: vi.fn(original.plotViewSvg),
    plotViewTable: vi.fn(original.plotViewTable),
  }
})

const plot: PlotView = { kind: 'dot', model: dotPlotModel(plotTestInput) }

describe('PlotsPanel renders', () => {
  it('draws an unchanged plot and its table once, however often App renders', () => {
    const plots = testPlotsModel({ message: null, plot })
    const { rerender } = render(<PlotsPanel plots={plots} />)
    // App renders on hovers and view reports, with a new model each time.
    rerender(<PlotsPanel plots={{ ...plots }} />)
    rerender(<PlotsPanel plots={{ ...plots }} />)

    expect(plotViews.plotViewSvg).toHaveBeenCalledTimes(1)

    const table = { ...plots, showNumbers: true }
    rerender(<PlotsPanel plots={table} />)
    rerender(<PlotsPanel plots={{ ...table }} />)

    expect(plotViews.plotViewTable).toHaveBeenCalledTimes(1)
  })
})
