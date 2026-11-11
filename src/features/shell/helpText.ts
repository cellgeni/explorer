// What the info tips beside some controls say (UNIFIED_PLAN.md, 15.3-B):
// terms the review found users could not work out from the label alone.
// The UI reference has the details.

export const EXPRESSION_DETAIL_HELP =
  'Level of detail (LOD). Auto LOD colours every cell of datasets up to 500,000 cells. On larger ones it reads a sample while zoomed out, and every cell in view once 50,000 or fewer are visible; samples keep every cell expressing the selected genes. Exact region reads the cells in view, All cells the whole slide.'

export const TRANSCRIPT_DETAIL_HELP =
  'Level of detail (LOD). Auto shows each transcript as a point when the view holds fewer than the point budget, and density squares when it holds more. Density counts transcripts per square; Exact always reads points.'

export const MIN_QV_HELP =
  "Quality value: the decoder's confidence in each transcript, on the Phred scale. QV 20 means about 1 in 100 calls is wrong. Points below the minimum are hidden; density always counts QV 20 and above."

export const BOUNDARY_LIMIT_HELP =
  'The most cells in view for which cell and nucleus outlines are drawn. With more cells in view, cells show as points until you zoom in. Higher limits use more memory and time.'

export const COMBINE_GENES_HELP =
  "How the selected genes become one score per cell. Sum adds their expression, Mean averages it, and Z-score shows how far each cell's mean is above or below the average cell, in standard deviations."
