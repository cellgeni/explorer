export type TelemetryOutcome = 'success' | 'failure' | 'info'

export interface TelemetryEvent {
  readonly name: string
  readonly timestamp: number
  readonly outcome: TelemetryOutcome
  readonly durationMs?: number
  readonly detail?: string
}

// Over the limit the oldest events go first, but not the latest of each
// name, so a burst of one kind (a tile cache evicting on every new tile, gene
// reads while panning) cannot push out the dataset load or diagnostics events.
export function appendTelemetryEvent(
  events: readonly TelemetryEvent[],
  event: TelemetryEvent,
  limit: number,
): readonly TelemetryEvent[] {
  const nextEvents = [...events, event]
  const maxEvents = Math.max(1, limit)
  let excess = nextEvents.length - maxEvents

  if (excess <= 0) {
    return nextEvents
  }

  const latestOfName = new Map<string, number>()
  nextEvents.forEach((next, index) => latestOfName.set(next.name, index))
  const kept = nextEvents.filter((next, index) => {
    if (excess > 0 && latestOfName.get(next.name) !== index) {
      excess -= 1
      return false
    }
    return true
  })

  return kept.slice(Math.max(0, kept.length - maxEvents))
}

export function telemetryEvent(
  name: string,
  outcome: TelemetryOutcome,
  options: {
    readonly startedAt?: number
    readonly timestamp?: number
    readonly detail?: string
  } = {},
): TelemetryEvent {
  const timestamp = options.timestamp ?? Date.now()

  return {
    name,
    outcome,
    timestamp,
    ...(options.startedAt === undefined
      ? {}
      : { durationMs: Math.max(0, timestamp - options.startedAt) }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  }
}
