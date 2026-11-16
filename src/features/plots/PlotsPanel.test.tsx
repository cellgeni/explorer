import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testPlotsModel } from '../../test/sectionModels'
import { dotPlotModel } from './dotPlot'
import { PlotsPanel } from './PlotsPanel'

const plot = dotPlotModel({
  groups: [
    { id: 'selection', label: 'ROI 1', color: '#f0c84b', kind: 'selection' },
    { id: 'analysis:cluster:a', label: 'A', color: '#1f77b4', kind: 'class' },
  ],
  genes: [
    {
      gene: 'Actb',
      stats: {
        gene: 'Actb',
        groups: [
          { cells: 4, expressing: 2, sum: 8, sumLog1p: 3 },
          { cells: 10, expressing: 0, sum: 0, sumLog1p: 0 },
        ],
        wholeNumbers: true,
        negative: false,
      },
    },
  ],
  scale: 'log1p',
  colour: 'shared',
  colorScale: 'plasma',
  valueLabel: 'log1p(counts)',
  setLabel: 'cluster',
})

describe('PlotsPanel (plan 22-D, 22-E)', () => {
  it('says what is missing in place of the plot', () => {
    render(<PlotsPanel plots={testPlotsModel()} />)

    expect(screen.getByText('Select genes in Cells › Genes to plot them.')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Group by' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export SVG' })).toBeDisabled()
  })

  it('draws the dot plot as a labelled image, and its numbers as a table', () => {
    const plots = testPlotsModel({
      message: null,
      plot,
      setOptions: [{ id: 'analysis:cluster', label: 'cluster', classCount: 1 }],
      setId: 'analysis:cluster',
      notes: ['1 hidden class left out.'],
    })
    const { rerender } = render(<PlotsPanel plots={plots} />)

    expect(
      screen.getByRole('img', { name: /Dot plot of Actb across 2 groups of cluster/ }),
    ).toBeVisible()
    expect(screen.getByText('1 hidden class left out.')).toBeVisible()
    fireEvent.click(screen.getByRole('switch', { name: 'Show numbers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(plots.onShowNumbersChange).toHaveBeenCalledWith(true)
    expect(plots.onExportCsv).toHaveBeenCalledTimes(1)

    rerender(<PlotsPanel plots={{ ...plots, showNumbers: true }} />)
    const table = screen.getByRole('table', { name: /Dot plot of Actb/ })
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual([
      'GroupGeneCells% expressingMean log1p(counts)',
      'ROI 1 (selection)Actb450%0.75',
      'AActb100%0',
    ])
  })

  it('changes the set, scale and colour, and turns log1p off for scaled values', () => {
    const plots = testPlotsModel({
      setOptions: [
        { id: 'analysis:cluster', label: 'cluster', classCount: 3 },
        { id: 'loaded-annotations', label: 'Loaded annotations', classCount: 1 },
      ],
      setId: 'analysis:cluster',
      scale: 'stored',
      log1pAvailable: false,
    })
    render(<PlotsPanel plots={plots} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), {
      target: { value: 'loaded-annotations' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Colour' }), {
      target: { value: 'per-gene' },
    })

    expect(plots.onSetChange).toHaveBeenCalledWith('loaded-annotations')
    expect(plots.onColourChange).toHaveBeenCalledWith('per-gene')
    expect(screen.getByRole('option', { name: 'log1p' })).toBeDisabled()
  })

  it('offers Cancel while reading and Try again after', () => {
    const reading = testPlotsModel({
      reading: true,
      message: 'Reading the selected genes…',
    })
    const { rerender } = render(<PlotsPanel plots={reading} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(reading.onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    const failed = testPlotsModel({ canRetry: true, geneErrors: ['Vim failed.'] })
    rerender(<PlotsPanel plots={failed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(failed.onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Vim failed.')).toBeVisible()
  })
})
