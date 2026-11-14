import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testDatasetInfoModel } from '../../test/sectionModels'
import { InfoDrawer } from './InfoDrawer'

function sectionTitles(): readonly (string | null)[] {
  return within(screen.getByRole('dialog', { name: 'Dataset info' }))
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent)
}

describe('InfoDrawer', () => {
  it('says nothing is open and offers to open a dataset', () => {
    render(<InfoDrawer info={testDatasetInfoModel()} open onClose={vi.fn()} />)

    expect(sectionTitles()).toEqual(['Dataset', 'Open another dataset', 'Diagnostics'])
    expect(screen.getByText('No dataset is open.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
  })

  it('lists the dataset, its About and view options, and keeps the boundary limit under Advanced', () => {
    const info = testDatasetInfoModel({
      facts: [
        { label: 'Platform', value: 'Xenium' },
        { label: 'Cells', value: '1,414,155' },
      ],
      about: { name: 'Sob23 brain', description: 'Mouse brain, FFPE' },
      viewOptions: {
        spatialData: {
          state: {
            status: 'ready',
            tables: [],
            coordinateSystem: 'global',
            coordinateSystems: ['global'],
            images: [],
            units: { micrometersPerUnit: 1, source: 'declared', detail: '' },
            selection: {},
          },
        },
      },
    })
    render(<InfoDrawer info={info} open onClose={vi.fn()} />)

    expect(sectionTitles()).toEqual([
      'Dataset',
      'About',
      'View options',
      'Open another dataset',
      'Diagnostics',
    ])
    const dataset = screen.getByRole('region', { name: 'Dataset' })
    expect(within(dataset).getByText('Cells').nextElementSibling).toHaveTextContent(
      '1,414,155',
    )
    expect(screen.getByText('Mouse brain, FFPE')).toBeInTheDocument()

    const advanced = screen.getByTitle('Advanced dataset options').closest('details')
    expect(advanced).not.toHaveAttribute('open')
    fireEvent.change(screen.getByLabelText('Boundary limit'), {
      target: { value: '200' },
    })
    expect(info.open.onBoundaryCellLimitChange).toHaveBeenCalledWith(200)
  })

  it('picks a SpatialData table and keeps a chosen table across view changes', () => {
    const onSelectionChange = vi.fn()
    const info = testDatasetInfoModel({
      viewOptions: {
        spatialData: {
          state: {
            status: 'ready',
            table: 'square_016um',
            tables: ['square_002um', 'square_008um', 'square_016um'],
            coordinateSystem: 'global',
            coordinateSystems: ['global', 'aligned'],
            images: [],
            units: { micrometersPerUnit: 0.27, source: 'declared', detail: '' },
            selection: { table: 'square_016um', image: 'hires' },
          },
          onSelectionChange,
        },
      },
    })
    render(<InfoDrawer info={info} open onClose={vi.fn()} />)
    const view = screen.getByRole('region', { name: 'SpatialData view' })

    expect(within(view).getByLabelText('Table')).toHaveValue('square_016um')
    // A table decides the coordinate system, so the rest is chosen again.
    fireEvent.change(within(view).getByLabelText('Table'), {
      target: { value: 'square_008um' },
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith({ table: 'square_008um' })

    fireEvent.change(within(view).getByLabelText('Coordinate system'), {
      target: { value: 'aligned' },
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      table: 'square_016um',
      coordinateSystem: 'aligned',
    })
  })

  it('lists issues and, in debug mode, the layer stack under Diagnostics', () => {
    render(
      <InfoDrawer
        info={testDatasetInfoModel({
          diagnostics: {
            errors: [
              {
                title: 'Boundaries failed',
                message: 'HTTP 403',
                kind: 'network',
              } as never,
            ],
            layerStack: {
              deckLayerCount: 1,
              deckVersion: '9.3.2',
              performanceBudget: {
                profile: 'balanced',
                overviewRenderCellLimit: 150_000,
                boundaryCellLimit: 50_000,
                maxConcurrentTileRequests: 4,
                tileCacheMaxTiles: 120,
                telemetryEventLimit: 120,
              },
            },
          },
        })}
        open
        onClose={vi.fn()}
      />,
    )

    const diagnostics = screen.getByRole('region', { name: 'Diagnostics' })
    expect(
      within(diagnostics).getByRole('alert', { name: 'Load issues' }),
    ).toHaveTextContent('Boundaries failed')
    expect(within(diagnostics).getByText(/deck\.gl 9\.3\.2/)).toBeInTheDocument()
  })
})
