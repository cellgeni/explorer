// What the canvas legend shows (UNIFIED_PLAN.md, 15.1-C). App builds the
// sections from its colour state; ViewerLegend only draws them.

export interface ContinuousLegendSection {
  readonly kind: 'continuous'
  readonly id: string
  readonly title: string
  // A second line, such as "Sum of 2 genes per cell".
  readonly detail?: string | undefined
  // CSS gradient, low on the left.
  readonly gradient: string
  readonly min: string
  readonly max: string
}

export interface CategoryLegendItem {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly count: number
  readonly visible: boolean
}

export interface CategoryLegendSection {
  readonly kind: 'categories'
  readonly id: string
  readonly title: string
  // Every category. The legend lists the first LEGEND_CATEGORY_LIMIT.
  readonly items: readonly CategoryLegendItem[]
}

export type ViewerLegendSection = ContinuousLegendSection | CategoryLegendSection

export const LEGEND_CATEGORY_LIMIT = 12
