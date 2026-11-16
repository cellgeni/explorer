// One view shared by the viewers of registered sections shown side by side:
// the main viewer and each linked panel. Whichever is panned or zoomed
// publishes its view, and the others follow it. Every viewer of a section has
// the same coordinates, so the same target and zoom show the same place at
// the same scale.

export interface LinkedViewState {
  // Deck.gl coordinates: x, and the data's y negated.
  readonly target: readonly [number, number]
  // 2^zoom pixels per µm.
  readonly zoom: number
}

export class LinkedViewChannel {
  private current: LinkedViewState | null = null
  private currentSource: string | null = null
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // The latest view, or null before any viewer has published one.
  readonly getView = (): LinkedViewState | null => this.current

  // The viewer that published it, so it does not apply its own view again.
  get source(): string | null {
    return this.currentSource
  }

  // Values are compared exactly: a viewer that follows sets exactly what it
  // was given, so its own publish of it changes nothing, while any rounding
  // here would leave the viewers apart by up to that much.
  publish(view: LinkedViewState, source: string): void {
    const current = this.current

    if (
      current !== null &&
      current.target[0] === view.target[0] &&
      current.target[1] === view.target[1] &&
      current.zoom === view.zoom
    ) {
      return
    }

    this.current = { target: [view.target[0], view.target[1]], zoom: view.zoom }
    this.currentSource = source

    for (const listener of this.listeners) listener()
  }
}
