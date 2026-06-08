import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import type { AppControlIds } from './useAppControlIds'
import { useAppControlIds } from './useAppControlIds'

let ids: AppControlIds

function Probe({ onReady }: { readonly onReady: (nextIds: AppControlIds) => void }) {
  const nextIds = useAppControlIds()

  React.useEffect(() => {
    onReady(nextIds)
  })

  return null
}

describe('useAppControlIds', () => {
  it('provides stable unique IDs for app controls', () => {
    render(
      <Probe
        onReady={(nextIds) => {
          ids = nextIds
        }}
      />,
    )

    const values = Object.values(ids)

    expect(values.every((value) => value.length > 0)).toBe(true)
    expect(new Set(values).size).toBe(values.length)
  })
})
