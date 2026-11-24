import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { focusedIndexAmong, nthOrLast, useKeepFocus } from './useKeepFocus'

// Rows with a Remove each, a Busy button that turns itself off, and a field
// that takes focus once no row is left.
function Rows({ initial }: { readonly initial: readonly string[] }) {
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const keepFocus = useKeepFocus(
    (index) =>
      nthOrLast(listRef.current?.querySelectorAll('button'), index) ?? fieldRef.current,
  )

  return (
    <>
      <input ref={fieldRef} title="Field" />
      <ul ref={listRef}>
        {rows.map((row) => (
          <li key={row}>
            <button
              type="button"
              title={`Remove ${row}`}
              onClick={() => {
                keepFocus(
                  focusedIndexAmong(listRef.current?.querySelectorAll('button') ?? []),
                )
                setRows((current) => current.filter((other) => other !== row))
              }}
            >
              Remove {row}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        title="Busy"
        disabled={busy}
        onClick={() => {
          keepFocus()
          setBusy(true)
        }}
      >
        Busy
      </button>
      <button type="button" title="Elsewhere">
        Elsewhere
      </button>
    </>
  )
}

function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  fireEvent.click(button)
}

describe('useKeepFocus', () => {
  it('moves focus to the row now in the removed one’s place', () => {
    render(<Rows initial={['a', 'b', 'c']} />)
    press('Remove b')
    expect(screen.getByRole('button', { name: 'Remove c' })).toHaveFocus()
  })

  it('moves focus to the last row when the last is removed', () => {
    render(<Rows initial={['a', 'b', 'c']} />)
    press('Remove c')
    expect(screen.getByRole('button', { name: 'Remove b' })).toHaveFocus()
  })

  it('moves focus to the fallback once no row is left', () => {
    render(<Rows initial={['a']} />)
    press('Remove a')
    expect(screen.getByTitle('Field')).toHaveFocus()
  })

  it('moves focus on from a control that disables itself', () => {
    render(<Rows initial={[]} />)
    press('Busy')
    expect(screen.getByRole('button', { name: 'Busy' })).toBeDisabled()
    expect(screen.getByTitle('Field')).toHaveFocus()
  })

  it('leaves focus alone when the control was not focused', () => {
    render(<Rows initial={['a', 'b']} />)
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }))
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })
})
