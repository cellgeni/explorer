import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CellGeneExpressionSummary } from './cellDetailModel'
import { CellGeneExpressionList } from './CellGeneExpressionList'

function expression(
  genes: readonly (readonly [string, number])[],
  hitGeneLimit = false,
): CellGeneExpressionSummary {
  const totalCount = genes.reduce((sum, [, count]) => sum + count, 0)

  return {
    genes: genes.map(([gene, count]) => ({
      gene,
      count,
      percentTotal: totalCount === 0 ? 0 : (count / totalCount) * 100,
    })),
    totalCount,
    hitGeneLimit,
  }
}

const GENES = expression([
  ['Gad1', 1200],
  ['Slc17a7', 600],
  ['GAD2', 300],
  ['Actb', 3],
])

function rows(): readonly HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Cell gene expression' })).getAllByRole(
    'listitem',
  )
}

describe('CellGeneExpressionList', () => {
  it('lists genes in the given order with counts and share of the total', () => {
    render(<CellGeneExpressionList expression={GENES} />)

    const items = rows()
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual([
      'Gad1',
      'Slc17a7',
      'GAD2',
      'Actb',
    ])
    expect(within(items[0]!).getByText('1,200')).toBeInTheDocument()
    // 1200 of 2103 counts, to one decimal place.
    expect(within(items[0]!).getByText('57.1% total')).toBeInTheDocument()
    expect(within(items[3]!).getByText('0.1% total')).toBeInTheDocument()
  })

  it('sizes bars against the most expressed gene, with a 2% minimum', () => {
    render(<CellGeneExpressionList expression={GENES} />)

    const widths = rows().map((item) => item.style.getPropertyValue('--cell-gene-width'))
    expect(widths).toEqual(['100%', '50%', '25%', '2%'])
  })

  it('draws no bars when every count is zero', () => {
    render(<CellGeneExpressionList expression={expression([['Gad1', 0]])} />)

    expect(rows()[0]!.style.getPropertyValue('--cell-gene-width')).toBe('0%')
  })

  it('filters genes by a case-insensitive, trimmed search', () => {
    render(<CellGeneExpressionList expression={GENES} />)
    const search = screen.getByLabelText('Gene filter')

    fireEvent.change(search, { target: { value: '  gad ' } })
    expect(rows().map((item) => item.querySelector('span')?.textContent)).toEqual([
      'Gad1',
      'GAD2',
    ])
    // Bars keep their width relative to every gene, not just the matches.
    expect(rows()[1]!.style.getPropertyValue('--cell-gene-width')).toBe('25%')

    fireEvent.change(search, { target: { value: 'xyz' } })
    expect(screen.getByText('No matching genes')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    expect(rows()).toHaveLength(4)
  })

  it('says when the cell has no expressed genes', () => {
    render(<CellGeneExpressionList expression={expression([])} />)

    expect(screen.getByText('No expressed genes found')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing first/)).not.toBeInTheDocument()
  })

  it('notes when the list stopped at the gene limit', () => {
    const { rerender } = render(
      <CellGeneExpressionList expression={expression([['Gad1', 4]], true)} />,
    )

    expect(screen.getByText('Showing first 100,000 genes')).toBeInTheDocument()

    rerender(
      <CellGeneExpressionList
        expression={expression([['Gad1', 4]], true)}
        hitLimitCopy="Showing first 100,000 bin genes"
      />,
    )
    expect(screen.getByText('Showing first 100,000 bin genes')).toBeInTheDocument()
  })

  it('uses the given labels for the list and the search box', () => {
    render(
      <CellGeneExpressionList
        expression={GENES}
        ariaLabel="Top selected bin genes"
        filterLabel="Bin gene filter"
        searchPlaceholder="Search bin genes"
      />,
    )

    expect(
      screen.getByRole('list', { name: 'Top selected bin genes' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Bin gene filter')).toHaveAttribute(
      'placeholder',
      'Search bin genes',
    )
  })
})
