import { describe, expect, it } from 'vitest'
import {
  ateraImageControlLoading,
  ateraImageControlReady,
  ateraImageSelectionToShareable,
  IDLE_ATERA_IMAGE_STATE,
  parseAteraImageChoice,
} from './ateraImageModel'

describe('ateraImageModel', () => {
  it('parses the link value', () => {
    expect(parseAteraImageChoice('3d')).toBe('3d')
    expect(parseAteraImageChoice('2d')).toBe('2d')
    expect(parseAteraImageChoice('4d')).toBeUndefined()
    expect(parseAteraImageChoice(undefined)).toBeUndefined()
  })

  it('names the 3D stack in the link and leaves the 2D default out', () => {
    expect(ateraImageSelectionToShareable(IDLE_ATERA_IMAGE_STATE)).toEqual({})
    expect(ateraImageSelectionToShareable(ateraImageControlReady('2d'))).toEqual({})
    expect(ateraImageSelectionToShareable(ateraImageControlReady('3d'))).toEqual({
      ateraImage: '3d',
    })
  })

  it('marks a change as loading only when the control is shown', () => {
    expect(ateraImageControlLoading(IDLE_ATERA_IMAGE_STATE, '3d')).toBe(
      IDLE_ATERA_IMAGE_STATE,
    )
    expect(ateraImageControlLoading(ateraImageControlReady('2d'), '3d')).toEqual({
      status: 'loading',
      choice: '3d',
    })
  })
})
