import type { FloatingWindowSize } from './FloatingWindow'

// The windows over the canvas (plan 15.2-G, 22-D8).
export const EMBEDDING_WINDOW_SIZE: FloatingWindowSize = { width: 360, height: 400 }
export const EMBEDDING_WINDOW_MIN_SIZE: FloatingWindowSize = { width: 280, height: 260 }
export const PLOTS_WINDOW_SIZE: FloatingWindowSize = { width: 480, height: 420 }
export const PLOTS_WINDOW_MIN_SIZE: FloatingWindowSize = { width: 320, height: 280 }
export const QUERY_WINDOW_SIZE: FloatingWindowSize = { width: 520, height: 460 }
export const QUERY_WINDOW_MIN_SIZE: FloatingWindowSize = { width: 360, height: 300 }

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

// The Cell Query window opens to the left of the other open windows
// (23-D9), whose widths are given right to left.
export function queryWindowRightOffset(
  openWidths: readonly number[],
  narrow: boolean,
): number | undefined {
  if (narrow || openWidths.length === 0) return undefined
  return openWidths.reduce((offset, width) => offset + width + WINDOW_GAP, RIGHT_INSET)
}
