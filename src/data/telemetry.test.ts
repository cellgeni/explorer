import { describe, expect, it } from 'vitest'
import { appendTelemetryEvent, telemetryEvent } from './telemetry'

describe('telemetry', () => {
  it('keeps the newest events inside the limit', () => {
    const events = [
      telemetryEvent('first', 'info', { timestamp: 1 }),
      telemetryEvent('second', 'info', { timestamp: 2 }),
    ]

    const next = appendTelemetryEvent(
      events,
      telemetryEvent('third', 'success', { timestamp: 3 }),
      2,
    )

    expect(next.map((event) => event.name)).toEqual(['second', 'third'])
  })

  // One tile-cache eviction per new tile filled the ring and pushed out the
  // load and diagnostics events the dump is for (EXP-232).
  it('keeps the latest event of each name when one kind floods the ring', () => {
    let events = appendTelemetryEvent(
      [],
      telemetryEvent('dataset.load', 'success', { timestamp: 1 }),
      120,
    )
    events = appendTelemetryEvent(
      events,
      telemetryEvent('dataset.diagnostics', 'success', { timestamp: 2 }),
      120,
    )

    for (let tile = 0; tile < 300; tile += 1) {
      events = appendTelemetryEvent(
        events,
        telemetryEvent('tile-cache.eviction', 'info', { timestamp: 3 + tile }),
        120,
      )
    }

    expect(events).toHaveLength(120)
    expect(events.slice(0, 2).map((event) => event.name)).toEqual([
      'dataset.load',
      'dataset.diagnostics',
    ])
    expect(events.at(-1)?.timestamp).toBe(302)
  })

  it('records duration from a start timestamp', () => {
    expect(
      telemetryEvent('dataset.load', 'success', {
        startedAt: 100,
        timestamp: 175,
      }).durationMs,
    ).toBe(75)
  })
})
