export type TelemetryOutcome = 'success' | 'failure' | 'info'

export interface TelemetryEvent {
  readonly name: string
  readonly timestamp: number
  readonly outcome: TelemetryOutcome
  readonly durationMs?: number
  readonly detail?: string
}

export function appendTelemetryEvent(
  events: readonly TelemetryEvent[],
  event: TelemetryEvent,
  limit: number,
): readonly TelemetryEvent[] {
  const nextEvents = [...events, event]
  return nextEvents.slice(Math.max(0, nextEvents.length - Math.max(1, limit)))
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
