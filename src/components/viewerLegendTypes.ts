// What the canvas legend shows (plan 15.1-C). App builds the
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
  // What the counts count; cells by default.
  readonly noun?: { readonly singular: string; readonly plural: string } | undefined
  // Categories not in items, added to "+n more".
  readonly moreCount?: number | undefined
  // Where the rest are listed; "Cells › Clusters" by default.
  readonly moreWhere?: string | undefined
  // Alt- or Shift-click, or Enter, on an eye shows only that category.
  readonly showOnly?: boolean | undefined
}

export type PythonLegendSwatch =
  | { readonly kind: 'color'; readonly color: string }
  // A highlight's ring.
  | { readonly kind: 'ring'; readonly color: string }
  | {
      readonly kind: 'ramp'
      // CSS gradient, low on the left.
      readonly gradient: string
      readonly min: string
      readonly max: string
    }
  // The cells show() keeps.
  | { readonly kind: 'shown' }

export interface PythonLegendItem {
  readonly id: string
  readonly label: string
  readonly count: number
  readonly swatch: PythonLegendSwatch
}

// The Python console's layers (plan 29-D8), each with a button to clear it.
export interface PythonLegendSection {
  readonly kind: 'python'
  readonly id: string
  readonly title: string
  readonly items: readonly PythonLegendItem[]
  // What happens to the cells no layer colours.
  readonly detail?: string | undefined
  readonly noun: { readonly singular: string; readonly plural: string }
}

export type ViewerLegendSection =
  | ContinuousLegendSection
  | CategoryLegendSection
  | PythonLegendSection

export const LEGEND_CATEGORY_LIMIT = 12
