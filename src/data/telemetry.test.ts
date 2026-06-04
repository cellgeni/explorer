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

  it('records duration from a start timestamp', () => {
    expect(
      telemetryEvent('dataset.load', 'success', {
        startedAt: 100,
        timestamp: 175,
      }).durationMs,
    ).toBe(75)
  })
})
