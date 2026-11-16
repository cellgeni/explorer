import type { FloatingWindowSize } from './FloatingWindow'

// The windows over the canvas (plan 15.2-G, 22-D8).
export const EMBEDDING_WINDOW_SIZE: FloatingWindowSize = { width: 360, height: 400 }
export const EMBEDDING_WINDOW_MIN_SIZE: FloatingWindowSize = { width: 280, height: 260 }
export const PLOTS_WINDOW_SIZE: FloatingWindowSize = { width: 480, height: 420 }
export const PLOTS_WINDOW_MIN_SIZE: FloatingWindowSize = { width: 320, height: 280 }

// The CSS inset from the canvas's right edge (--space-3), and the gap
// between two windows (--space-2).
const RIGHT_INSET = 12
const WINDOW_GAP = 8

// The Plots window opens to the left of an open Embedding window (22-D8).
// Under 860 px only one is open, at full width.
export function plotsWindowRightOffset(
  embeddingOpen: boolean,
  embeddingWidth: number,
  narrow: boolean,
): number | undefined {
  return embeddingOpen && !narrow ? RIGHT_INSET + embeddingWidth + WINDOW_GAP : undefined
}
