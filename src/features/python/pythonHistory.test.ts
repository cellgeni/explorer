import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../test/memoryStorage'
import {
  addPythonHistory,
  readPythonHistory,
  stepPythonHistory,
  type PythonHistoryStorage,
} from './pythonHistory'

describe('the Python console history', () => {
  it('keeps inputs across visits, without repeats or blanks', () => {
    const storage = memoryStorage()
    let history = readPythonHistory(storage)
    expect(history).toEqual([])
    history = addPythonHistory(history, 'len(cells)', storage)
    history = addPythonHistory(history, 'len(cells)', storage)
    history = addPythonHistory(history, '   ', storage)
    expect(addPythonHistory(history, 'cells.x', storage)).toEqual([
      'len(cells)',
      'cells.x',
    ])
    expect(readPythonHistory(storage)).toEqual(['len(cells)', 'cells.x'])
  })

  it('lasts for the page where storage refuses, and ignores what is not a list', () => {
    const refusing: PythonHistoryStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readPythonHistory(refusing)).toEqual([])
    expect(addPythonHistory([], 'x = 1', refusing)).toEqual(['x = 1'])

    const storage = memoryStorage()
    storage.setItem('explorer.python.history', '{"not": "a list"}')
    expect(readPythonHistory(storage)).toEqual([])
  })

  it('walks back and forward, keeping the input being written', () => {
    const history = ['a', 'b']
    const start = { index: 2, draft: '' }
    const back = stepPythonHistory(history, start, 'draft', -1)
    expect(back?.text).toBe('b')
    const further = stepPythonHistory(history, back!.cursor, 'b', -1)
    expect(further?.text).toBe('a')
    expect(stepPythonHistory(history, further!.cursor, 'a', -1)).toBeNull()
    const forward = stepPythonHistory(history, further!.cursor, 'a', 1)
    const draft = stepPythonHistory(history, forward!.cursor, 'b', 1)
    expect(draft?.text).toBe('draft')
    expect(stepPythonHistory(history, draft!.cursor, 'draft', 1)).toBeNull()
  })
})
