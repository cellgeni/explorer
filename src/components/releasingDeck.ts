import { Deck, type View } from '@deck.gl/core'

// @deck.gl/react finalizes its Deck when <DeckGL> unmounts, but
// Deck.finalize() leaves the luma.gl device running: its canvas context keeps
// a matchMedia listener, which keeps the device, the Deck and its layers' data
// reachable, and the WebGL context stays live. Chromium allows 16 live
// contexts per page and drops the oldest past that. Each dataset switch kept
// the previous view's context and data, and the 16th opening of a 3D view
// blanked the 2D view. Pass this class as <DeckGL Deck={ReleasingDeck}> to
// lose the context and stop the observers once the canvas has left the page.
export class ReleasingDeck<
  ViewsT extends View | View[] | null = null,
> extends Deck<ViewsT> {
  override finalize(): void {
    const canvas = this.canvas ?? this.props.canvas
    // A Deck finalized before its device was ready still gets one.
    const device = this.device ?? this.animationLoop?.props.device
    super.finalize()
    // React StrictMode finalizes the Deck and makes another on the same
    // canvas, which stays on the page and is given this device back.
    if (
      device === undefined ||
      (canvas instanceof HTMLCanvasElement && canvas.isConnected)
    ) {
      return
    }
    void Promise.resolve(device).then(
      (ready) => {
        if (!ready.isLost) ready.loseDevice()
        ready.canvasContext?.destroy()
        ready.destroy()
      },
      () => undefined,
    )
  }
}
