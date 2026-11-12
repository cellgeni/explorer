import { describe, expect, it } from 'vitest'
import { classNames } from './classNames'

describe('classNames', () => {
  it('joins the names that are set with single spaces, in order', () => {
    expect(classNames('button', 'is-active', 'compact')).toBe('button is-active compact')
  })

  it('skips false, null, undefined and empty names', () => {
    const isActive = false
    const isPending = true

    expect(
      classNames(
        'button',
        isActive && 'is-active',
        null,
        undefined,
        '',
        isPending && 'is-pending',
      ),
    ).toBe('button is-pending')
  })

  it('returns an empty string when no name is set', () => {
    expect(classNames()).toBe('')
    expect(classNames(false, null, undefined, '')).toBe('')
  })

  it('keeps names as given, without trimming or removing duplicates', () => {
    expect(classNames('a b', 'a')).toBe('a b a')
  })
})
