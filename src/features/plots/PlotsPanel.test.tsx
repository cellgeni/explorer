import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plotTestInput } from '../../test/plotFixtures'
import { testPlotsModel } from '../../test/sectionModels'
import { dotPlotModel } from './dotPlot'
import { heatmapModel } from './heatmap'
import { PlotsPanel } from './PlotsPanel'
import type { PlotView } from './plotViews'
import { violinPlotModel } from './violinPlot'

const input = { ...plotTestInput, scale: 'log1p' as const, valueLabel: 'log1p(counts)' }
const plot: PlotView = { kind: 'dot', model: dotPlotModel(input) }
const setOptions = [{ id: 'analysis:cluster', label: 'cluster', classCount: 2 }]

describe('PlotsPanel (plan 22-D to 22-G)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
      setOptions,
      setId: 'analysis:cluster',
      notes: ['1 hidden class left out.'],
    })
    const { rerender } = render(<PlotsPanel plots={plots} />)

    expect(
      screen.getByRole('img', {
        name: /Dot plot of Actb, Gad1 and Gapdh across 3 groups of cluster/,
      }),
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
      'ROI 1 (selection)Actb450%0.805',
      'AActb1050%0.549',
      'B & <C>Actb0––',
      'ROI 1 (selection)Gad140%0',
      'AGad11010%0.0693',
      'B & <C>Gad10––',
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

  it('offers Read for a large read, titled with its size', () => {
    const plots = testPlotsModel({
      message:
        'Reading Gad1 reads about 180 MiB of the matrix, uncompressed. Read to go ahead.',
      confirmReadTitle: 'Read Gad1: about 180 MiB of the matrix',
    })
    render(<PlotsPanel plots={plots} />)

    expect(screen.getByText(/reads about 180 MiB/)).toBeVisible()
    const read = screen.getByRole('button', { name: 'Read' })
    expect(read).toHaveAttribute('title', 'Read Gad1: about 180 MiB of the matrix')
    fireEvent.click(read)
    expect(plots.onConfirmRead).toHaveBeenCalledTimes(1)
  })

  it('switches plots, with Include zeros for the violin in place of Colour', () => {
    const plots = testPlotsModel({
      message: null,
      plotKind: 'violin',
      plot: { kind: 'violin', model: violinPlotModel({ ...input, includeZeros: true }) },
      setOptions,
      setId: 'analysis:cluster',
    })
    render(<PlotsPanel plots={plots} />)

    expect(screen.getByRole('img', { name: /^Violin plot of Actb/ })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Colour' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Include zeros' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Plot' }), {
      target: { value: 'heatmap' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }))

    expect(plots.onIncludeZerosChange).toHaveBeenCalledWith(false)
    expect(plots.onPlotKindChange).toHaveBeenCalledWith('heatmap')
    expect(plots.onExportPng).toHaveBeenCalledTimes(1)
  })

  it('draws the heatmap on a canvas with text labels, and says what a tile holds', () => {
    const fillRect = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
    } as DOMRect)
    render(
      <PlotsPanel
        plots={testPlotsModel({
          message: null,
          plotKind: 'heatmap',
          plot: { kind: 'heatmap', model: heatmapModel(input) },
          setOptions,
          setId: 'analysis:cluster',
        })}
      />,
    )

    const image = screen.getByRole('img', { name: /^Heatmap of Actb/ })
    // Two genes read by the two groups with cells.
    expect(fillRect).toHaveBeenCalledTimes(4)
    expect(screen.getByText('B & <C>')).toBeInTheDocument()
    expect(screen.getByText('Mean log1p(counts)')).toBeInTheDocument()

    // The second gene's column, the first group's row.
    const canvas = image.querySelector('canvas') as HTMLCanvasElement
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 5 })
    expect(
      screen.getByText('ROI 1, Gad1: 4 cells, 0% expressing, mean log1p(counts) 0'),
    ).toBeInTheDocument()
    fireEvent.pointerLeave(canvas)
    expect(screen.queryByText(/^ROI 1, Gad1:/)).toBeNull()
  })
})
