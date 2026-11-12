import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testEmbeddingModel } from '../../test/sectionModels'
import { EmbeddingWindow } from './EmbeddingWindow'

function panelStyle(): CSSStyleDeclaration {
  return screen.getByRole('region', { name: 'Embedding' }).style
}

describe('EmbeddingWindow', () => {
  it('loads embeddings, and closes', () => {
    const embedding = testEmbeddingModel()
    const onClose = vi.fn()
    render(<EmbeddingWindow embedding={embedding} open onClose={onClose} />)

    expect(screen.getByText('No embedding loaded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close embedding' }))
    fireEvent.keyDown(screen.getByLabelText('Embedding view'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Load Embeddings' }), {
      key: 'Escape',
    })

    expect(embedding.onLoad).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('takes focus when it opens and gives it back when it closes (15.5-D)', () => {
    const embedding = testEmbeddingModel()
    function Harness({ open }: { readonly open: boolean }) {
      return (
        <>
          <button type="button" title="Show the embedding panel">
            Show Embedding
          </button>
          <EmbeddingWindow embedding={embedding} open={open} onClose={vi.fn()} />
        </>
      )
    }
    const { rerender } = render(<Harness open={false} />)
    const opener = screen.getByRole('button', { name: 'Show Embedding' })
    opener.focus()

    rerender(<Harness open />)
    expect(screen.getByRole('button', { name: 'Close embedding' })).toHaveFocus()

    rerender(<Harness open={false} />)
    expect(opener).toHaveFocus()
  })

  it('stays mounted, hidden, while closed', () => {
    render(
      <EmbeddingWindow embedding={testEmbeddingModel()} open={false} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole('region', { name: 'Embedding' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell-embedding')).toHaveAttribute('hidden')
  })

  it('resizes from its grip by keyboard and pointer, within limits', () => {
    render(<EmbeddingWindow embedding={testEmbeddingModel()} open onClose={vi.fn()} />)
    const grip = screen.getByRole('button', { name: 'Resize the embedding panel' })

    expect(panelStyle().width).toBe('360px')
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(panelStyle().width).toBe('380px')
    expect(panelStyle().height).toBe('420px')
    // The grip says its size (15.5-D).
    expect(grip).toHaveAccessibleDescription('380 by 420 px')

    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 400, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(grip, { pointerId: 1 })
    expect(panelStyle().width).toBe('280px')
    expect(panelStyle().height).toBe('360px')
  })
})
