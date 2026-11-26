import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../test/memoryStorage'
import {
  clampPromptHeight,
  MIN_PROMPT_HEIGHT,
  readPromptHeight,
  writePromptHeight,
} from './pythonPromptHeight'

describe('the input height', () => {
  it('stays between two lines and what leaves the output room', () => {
    expect(clampPromptHeight(10, 400)).toBe(MIN_PROMPT_HEIGHT)
    expect(clampPromptHeight(150.4, 400)).toBe(150)
    expect(clampPromptHeight(900, 400)).toBe(280)
    // A console too short for both keeps the input's two lines.
    expect(clampPromptHeight(900, 100)).toBe(MIN_PROMPT_HEIGHT)
  })

  it('is kept across visits, and back to fitting the input', () => {
    const storage = memoryStorage()
    expect(readPromptHeight(storage)).toBeNull()
    writePromptHeight(180, storage)
    expect(readPromptHeight(storage)).toBe(180)
    writePromptHeight(null, storage)
    expect(readPromptHeight(storage)).toBeNull()
  })

  it('lasts as long as the page when storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readPromptHeight(broken)).toBeNull()
    expect(() => {
      writePromptHeight(100, broken)
    }).not.toThrow()
  })
})
