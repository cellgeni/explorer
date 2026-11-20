import { describe, expect, it } from 'vitest'
import { parseCentralDirectory } from '../../../../../src/data/zipArchive'

describe('repro harness', () => {
  it('imports reviewed source', () => {
    expect(typeof parseCentralDirectory).toBe('function')
  })
})
