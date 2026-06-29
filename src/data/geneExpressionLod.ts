import { micrometers } from './coords'
import type { BBox } from './coords'
import type { VisiumHdBinSizeMicrometers } from '../datasets/visiumHdDataset'

export const GENE_EXPRESSION_EXACT_REGION_CELL_LIMIT = 50_000
export const GENE_EXPRESSION_EXACT_CELL_LIMIT = GENE_EXPRESSION_EXACT_REGION_CELL_LIMIT
export const GENE_EXPRESSION_SAMPLE_CELL_LIMIT = 15_000
export const GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT = 15_000
export const GENE_EXPRESSION_SAMPLE_BBOX_PADDING_RATIO = 0.2
export const GENE_EXPRESSION_OVERVIEW_ZOOM_MAX = -1.25
export const GENE_EXPRESSION_OVERVIEW_VISIBLE_CELL_MIN = 100_000
export const VISIUM_HD_GENE_EXPRESSION_8UM_LOD_ZOOM_MAX =
  GENE_EXPRESSION_OVERVIEW_ZOOM_MAX
export const VISIUM_HD_GENE_EXPRESSION_16UM_LOD_ZOOM_MAX = -2.25

export type GeneExpressionLoadMode =
  | 'exact'
  | 'sampled'
  | 'overview-sampled'
  | 'exact-region'
  | 'all-cells'
export type GeneExpressionDetailMode = 'auto' | 'exact-region' | 'all-cells'

export interface GeneExpressionViewportDetail {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: {
    readonly target: readonly [number, number, number]
    readonly zoom: number
  }
}

export type GeneExpressionLodPlan =
  | {
      readonly kind: 'request'
      readonly mode: GeneExpressionLoadMode
      readonly bbox: BBox
      readonly cellLimit: number
      readonly sampleStride: number
      readonly sourceCellCount: number
      readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
    }
  | {
      readonly kind: 'waiting'
      readonly message: string
    }

export function planGeneExpressionLod(
  detail: GeneExpressionViewportDetail,
  options: {
    readonly detailMode: GeneExpressionDetailMode
    readonly slideBbox: BBox | null
    readonly totalCellCount: number
    readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
  },
): GeneExpressionLodPlan {
  if (options.detailMode === 'all-cells') {
    const sourceCellCount =
      options.slideBbox === null ? detail.visibleCellCount : options.totalCellCount

    return {
      kind: 'request',
      mode: 'all-cells',
      bbox: options.slideBbox ?? detail.bbox,
      cellLimit: Math.max(1, sourceCellCount),
      sampleStride: 1,
      sourceCellCount,
      ...(options.visiumHdBinSizeMicrometers === undefined
        ? {}
        : { visiumHdBinSizeMicrometers: options.visiumHdBinSizeMicrometers }),
    }
  }

  if (
    options.detailMode === 'exact-region' &&
    detail.visibleCellCount <= GENE_EXPRESSION_EXACT_REGION_CELL_LIMIT
  ) {
    return {
      kind: 'request',
      mode: 'exact-region',
      bbox: detail.bbox,
      cellLimit: Math.max(
        1,
        options.visiumHdBinSizeMicrometers === undefined
          ? detail.visibleCellCount
          : options.totalCellCount,
      ),
      sampleStride: 1,
      sourceCellCount: detail.visibleCellCount,
      ...(options.visiumHdBinSizeMicrometers === undefined
        ? {}
        : { visiumHdBinSizeMicrometers: options.visiumHdBinSizeMicrometers }),
    }
  }

  if (options.visiumHdBinSizeMicrometers !== undefined) {
    return planVisiumHdGeneExpressionLod(
      detail,
      options,
      options.visiumHdBinSizeMicrometers,
    )
  }

  if (
    options.slideBbox !== null &&
    options.totalCellCount > GENE_EXPRESSION_SAMPLE_CELL_LIMIT &&
    (detail.viewState.zoom <= GENE_EXPRESSION_OVERVIEW_ZOOM_MAX ||
      detail.visibleCellCount > GENE_EXPRESSION_OVERVIEW_VISIBLE_CELL_MIN)
  ) {
    return {
      kind: 'request',
      mode: 'overview-sampled',
      bbox: options.slideBbox,
      cellLimit: GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT,
      sampleStride: Math.max(
        1,
        Math.ceil(options.totalCellCount / GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT),
      ),
      sourceCellCount: options.totalCellCount,
    }
  }

  if (detail.visibleCellCount <= GENE_EXPRESSION_EXACT_CELL_LIMIT) {
    return {
      kind: 'request',
      mode: 'exact',
      bbox: detail.bbox,
      cellLimit: GENE_EXPRESSION_EXACT_CELL_LIMIT,
      sampleStride: 1,
      sourceCellCount: detail.visibleCellCount,
    }
  }

  return {
    kind: 'request',
    mode: 'sampled',
    bbox: padBbox(detail.bbox, GENE_EXPRESSION_SAMPLE_BBOX_PADDING_RATIO),
    cellLimit: GENE_EXPRESSION_SAMPLE_CELL_LIMIT,
    sampleStride: Math.max(
      1,
      Math.ceil(detail.visibleCellCount / GENE_EXPRESSION_SAMPLE_CELL_LIMIT),
    ),
    sourceCellCount: detail.visibleCellCount,
  }
}

export function geneExpressionRequestKey(
  baseUrl: string,
  detail: GeneExpressionViewportDetail,
  plan: Extract<GeneExpressionLodPlan, { readonly kind: 'request' }>,
  genes: readonly string[],
): string {
  const visiumBinKey =
    plan.visiumHdBinSizeMicrometers === undefined
      ? 'bin-default'
      : `${plan.visiumHdBinSizeMicrometers}um`

  if (plan.mode === 'overview-sampled' || plan.mode === 'all-cells') {
    return [
      baseUrl.replace(/\/+$/, ''),
      visiumBinKey,
      plan.mode,
      bboxKey(plan.bbox, 1),
      plan.cellLimit,
      plan.sampleStride,
      genes.join('|'),
    ].join(':')
  }

  const [targetX = 0, targetY = 0] = detail.viewState.target
  const viewportSpan = Math.max(
    detail.bbox.maxX - detail.bbox.minX,
    detail.bbox.maxY - detail.bbox.minY,
    1,
  )
  const targetBucket = plan.mode === 'sampled' ? Math.max(500, viewportSpan / 6) : 100
  const zoomBucket = plan.mode === 'sampled' ? 0.25 : 0.001
  const roundedZoom =
    Math.round(Math.round(detail.viewState.zoom / zoomBucket) * zoomBucket * 1000) / 1000

  return [
    baseUrl.replace(/\/+$/, ''),
    visiumBinKey,
    Math.round(targetX / targetBucket) * targetBucket,
    Math.round(targetY / targetBucket) * targetBucket,
    roundedZoom,
    plan.mode,
    plan.cellLimit,
    plan.sampleStride,
    genes.join('|'),
  ].join(':')
}

export function geneExpressionWaitingKey(
  baseUrl: string,
  detail: GeneExpressionViewportDetail,
  genes: readonly string[],
  detailMode: GeneExpressionDetailMode,
): string {
  const [targetX = 0, targetY = 0] = detail.viewState.target

  return [
    baseUrl.replace(/\/+$/, ''),
    'waiting',
    detailMode,
    Math.round(targetX / 500) * 500,
    Math.round(targetY / 500) * 500,
    Math.round(detail.viewState.zoom * 100) / 100,
    detail.visibleCellCount,
    genes.join('|'),
  ].join(':')
}

function planVisiumHdGeneExpressionLod(
  detail: GeneExpressionViewportDetail,
  options: {
    readonly detailMode: GeneExpressionDetailMode
    readonly slideBbox: BBox | null
    readonly totalCellCount: number
  },
  activeBinSizeMicrometers: VisiumHdBinSizeMicrometers,
): GeneExpressionLodPlan {
  const lodBinSizeMicrometers = visiumHdGeneExpressionLodBinSize(
    activeBinSizeMicrometers,
    detail.viewState.zoom,
  )
  const useSlideBbox =
    options.slideBbox !== null &&
    detail.viewState.zoom <= GENE_EXPRESSION_OVERVIEW_ZOOM_MAX
  const sourceCellCount = useSlideBbox ? options.totalCellCount : detail.visibleCellCount
  const requestBbox =
    useSlideBbox && options.slideBbox !== null ? options.slideBbox : detail.bbox
  const mode: GeneExpressionLoadMode = useSlideBbox
    ? 'all-cells'
    : options.detailMode === 'exact-region'
      ? 'exact-region'
      : 'exact'

  return {
    kind: 'request',
    mode,
    bbox: requestBbox,
    cellLimit: Math.max(1, options.totalCellCount, sourceCellCount),
    sampleStride: 1,
    sourceCellCount,
    visiumHdBinSizeMicrometers: lodBinSizeMicrometers,
  }
}

function visiumHdGeneExpressionLodBinSize(
  activeBinSizeMicrometers: VisiumHdBinSizeMicrometers,
  zoom: number,
): VisiumHdBinSizeMicrometers {
  if (activeBinSizeMicrometers === 2) {
    if (zoom <= VISIUM_HD_GENE_EXPRESSION_16UM_LOD_ZOOM_MAX) {
      return 16
    }

    if (zoom <= VISIUM_HD_GENE_EXPRESSION_8UM_LOD_ZOOM_MAX) {
      return 8
    }

    return 2
  }

  if (
    activeBinSizeMicrometers === 8 &&
    zoom <= VISIUM_HD_GENE_EXPRESSION_8UM_LOD_ZOOM_MAX
  ) {
    return 16
  }

  return activeBinSizeMicrometers
}

function padBbox(bbox: BBox, ratio: number): BBox {
  const paddingX = (bbox.maxX - bbox.minX) * ratio
  const paddingY = (bbox.maxY - bbox.minY) * ratio

  return {
    minX: micrometers(bbox.minX - paddingX),
    maxX: micrometers(bbox.maxX + paddingX),
    minY: micrometers(bbox.minY - paddingY),
    maxY: micrometers(bbox.maxY + paddingY),
  }
}

function bboxKey(bbox: BBox, precision: number): string {
  return [
    roundTo(bbox.minX, precision),
    roundTo(bbox.maxX, precision),
    roundTo(bbox.minY, precision),
    roundTo(bbox.maxY, precision),
  ].join(',')
}

function roundTo(value: number, precision: number): number {
  return Math.round(value / precision) * precision
}
