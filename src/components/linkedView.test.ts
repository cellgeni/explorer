import { describe, expect, it, vi } from 'vitest'
import { LinkedViewChannel } from './linkedView'

describe('LinkedViewChannel', () => {
  it('hands each new view to the listeners with the viewer that sent it', () => {
    const channel = new LinkedViewChannel()
    const listener = vi.fn()
    const unsubscribe = channel.subscribe(listener)

    expect(channel.getView()).toBeNull()

    channel.publish({ target: [10, -20], zoom: 2 }, 'main')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(channel.getView()).toEqual({ target: [10, -20], zoom: 2 })
    expect(channel.source).toBe('main')

    channel.publish({ target: [12, -20], zoom: 2 }, 'panel-1')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(channel.source).toBe('panel-1')

    unsubscribe()
    channel.publish({ target: [0, 0], zoom: 0 }, 'main')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ignores a view it already has, so a follower publishing it back is quiet', () => {
    const channel = new LinkedViewChannel()
    const listener = vi.fn()
    channel.subscribe(listener)

    channel.publish({ target: [10, -20], zoom: 2 }, 'panel-1')
    channel.publish({ target: [10, -20], zoom: 2 }, 'main')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(channel.source).toBe('panel-1')

    // Even a tiny move counts: at high zoom a fraction of a µm is many pixels.
    channel.publish({ target: [10.001, -20], zoom: 2 }, 'main')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps its own copy of the target', () => {
    const channel = new LinkedViewChannel()
    const target: [number, number] = [1, 2]

    channel.publish({ target, zoom: 0 }, 'main')
    target[0] = 99

    expect(channel.getView()?.target).toEqual([1, 2])
  })
})
