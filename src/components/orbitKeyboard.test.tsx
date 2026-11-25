import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { handleOrbitKey, orbitCanvasProps } from './orbitKeyboard'

// A canvas host as the 3D views draw it, with deck.gl's event root inside.
function renderCanvas(onReset = vi.fn(), onLookAlong = vi.fn()) {
  render(
    <div
      {...orbitCanvasProps('3D view canvas area', 'keys')}
      onKeyDown={(event) => {
        handleOrbitKey(event, onReset, onLookAlong)
      }}
    >
      <div className="deck-events-root" tabIndex={-1} />
      <input title="Inside" />
      <p id="keys">Shift+arrows rotate</p>
    </div>,
  )
  const canvas = screen.getByRole('img', { name: '3D view canvas area' })
  const root = canvas.querySelector<HTMLElement>('.deck-events-root')!
  const received: KeyboardEvent[] = []
  root.addEventListener('keydown', (event) => {
    received.push(event)
  })
  return { canvas, root, received, onReset, onLookAlong }
}

describe('orbitKeyboard', () => {
  it('names the canvas as a described Tab stop', () => {
    const { canvas } = renderCanvas()

    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAccessibleDescription('Shift+arrows rotate')
    expect(canvas.getAttribute('aria-keyshortcuts')).toContain('Shift+ArrowLeft')
  })

  it('hands arrows, + and - to deck.gl’s event root, with their modifiers', () => {
    const { canvas, received } = renderCanvas()

    expect(
      fireEvent.keyDown(canvas, { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true }),
    ).toBe(false)
    fireEvent.keyDown(canvas, { key: '+', code: 'NumpadAdd' })
    fireEvent.keyDown(canvas, { key: '-', code: 'Minus' })

    expect(received.map((event) => [event.code, event.shiftKey])).toEqual([
      ['ArrowLeft', true],
      ['Equal', false],
      ['Minus', false],
    ])
  })

  it('resets the camera on Home', () => {
    const { canvas, received, onReset } = renderCanvas()

    expect(fireEvent.keyDown(canvas, { key: 'Home', code: 'Home' })).toBe(false)
    expect(onReset).toHaveBeenCalledOnce()
    expect(received).toEqual([])
  })

  it('looks along an axis on X, Y and Z, as the layout types them', () => {
    const { canvas, received, onLookAlong } = renderCanvas()

    expect(fireEvent.keyDown(canvas, { key: 'x', code: 'KeyX' })).toBe(false)
    // AZERTY types z at the US W.
    fireEvent.keyDown(canvas, { key: 'z', code: 'KeyW' })
    // A Cyrillic layout: the key at the US Y.
    fireEvent.keyDown(canvas, { key: 'н', code: 'KeyY' })
    // Modifiers are left to the browser.
    fireEvent.keyDown(canvas, { key: 'z', code: 'KeyZ', metaKey: true })
    fireEvent.keyDown(canvas, { key: 'X', code: 'KeyX', shiftKey: true })

    expect(onLookAlong.mock.calls).toEqual([['x'], ['z'], ['y']])
    expect(received).toEqual([])
  })

  it('leaves other keys, and keys from inside, alone', () => {
    const { canvas, received, onReset } = renderCanvas()

    expect(fireEvent.keyDown(canvas, { key: 'a', code: 'KeyA' })).toBe(true)
    fireEvent.keyDown(screen.getByTitle('Inside'), {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
    })

    expect(received).toEqual([])
    expect(onReset).not.toHaveBeenCalled()
  })
})
