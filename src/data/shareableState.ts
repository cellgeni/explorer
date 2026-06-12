import { micrometers, type BBox, type DataPoint } from './coords'
import type { RoiSelection } from './roiSelection'

const HASH_VERSION = '1'

export interface ShareableViewState {
  readonly target: readonly [number, number, number]
  readonly zoom: number
}

export interface ShareableState {
  readonly datasetUrl?: string
  readonly selectedGenes?: readonly string[]
  readonly viewState?: ShareableViewState
  readonly roiSelection?: RoiSelection
  readonly activeTab?: string
  readonly geneExpressionColorScale?: string
  readonly geneExpressionScoreMode?: string
  readonly geneExpressionDetailMode?: string
  readonly observationColorMode?: string
  readonly coordinateUnit?: string
  readonly measurementUnit?: string
  readonly shouldLoadMorphology?: boolean
  readonly boundaryCellLimit?: number
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly morphologyEnabledChannelIds?: readonly string[]
  readonly transcriptOverlay?: boolean
  readonly transcriptDetailMode?: string
  readonly transcriptMinQv?: number
  readonly transcriptGeneOnly?: boolean
  readonly transcriptFeatureFilterMode?: string
  readonly transcriptDensityColorScale?: string
  readonly transcriptPointColorMode?: string
  readonly transcriptExactPointLimit?: number
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
  readonly magicLensScope?: string
  readonly magicLensActive?: boolean
  readonly magicLensRadiusMicrometers?: number
  readonly magicLensMinQv?: number
}

type MutableShareableState = {
  -readonly [Key in keyof ShareableState]?: ShareableState[Key]
}

export function parseShareableState(hash: string): ShareableState {
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash

  if (rawHash.trim() === '') {
    return {}
  }

  const params = new URLSearchParams(rawHash)
  const state: MutableShareableState = {}
  const datasetUrl = readString(params, 'dataset')
  const selectedGenes = readCsv(params, 'genes')
  const viewState = parseViewState(params.get('view'))
  const roiSelection = parseRoiSelection(params.get('roi'))
  const activeTab = readString(params, 'tab')
  const geneExpressionColorScale = readString(params, 'scale')
  const geneExpressionScoreMode = readString(params, 'score')
  const geneExpressionDetailMode = readString(params, 'detail')
  const observationColorMode = readString(params, 'cellColor')
  const coordinateUnit = readString(params, 'coord')
  const measurementUnit = readString(params, 'measureUnit')
  const shouldLoadMorphology = parseBoolean(params.get('morphology'))
  const boundaryCellLimit = parsePositiveInteger(params.get('boundaryLimit'))
  const imageOpacity = parseUnitNumber(params.get('imgOpacity'))
  const cellFillOpacity = parseUnitNumber(params.get('cellFill'))
  const cellBoundaryOpacity = parseUnitNumber(params.get('cellBoundary'))
  const morphologyEnabledChannelIds = readCsvAllowEmpty(params, 'channels')
  const transcriptOverlay = parseBoolean(params.get('tx'))
  const transcriptDetailMode = readString(params, 'txDetail')
  const transcriptMinQv = parseNonNegativeInteger(params.get('txQv'))
  const transcriptGeneOnly = parseBoolean(params.get('txGene'))
  const transcriptFeatureFilterMode = readString(params, 'txFilter')
  const transcriptDensityColorScale = readString(params, 'txDensity')
  const transcriptPointColorMode = readString(params, 'txColor')
  const transcriptExactPointLimit = parsePositiveInteger(params.get('txBudget'))
  const transcriptOpacity = parseUnitNumber(params.get('txOpacity'))
  const transcriptPointSize = parsePositiveInteger(params.get('txSize'))
  const magicLensScope = readString(params, 'lensScope')
  const magicLensActive = parseBoolean(params.get('lens'))
  const magicLensRadiusMicrometers = parsePositiveInteger(params.get('lensRadius'))
  const magicLensMinQv = parseNonNegativeInteger(params.get('lensQv'))

  if (datasetUrl !== undefined) {
    state.datasetUrl = datasetUrl
  }

  if (selectedGenes !== undefined) {
    state.selectedGenes = selectedGenes
  }

  if (viewState !== undefined) {
    state.viewState = viewState
  }

  if (roiSelection !== undefined) {
    state.roiSelection = roiSelection
  }

  if (activeTab !== undefined) {
    state.activeTab = activeTab
  }

  if (geneExpressionColorScale !== undefined) {
    state.geneExpressionColorScale = geneExpressionColorScale
  }

  if (geneExpressionScoreMode !== undefined) {
    state.geneExpressionScoreMode = geneExpressionScoreMode
  }

  if (geneExpressionDetailMode !== undefined) {
    state.geneExpressionDetailMode = geneExpressionDetailMode
  }

  if (observationColorMode !== undefined) {
    state.observationColorMode = observationColorMode
  }

  if (coordinateUnit !== undefined) {
    state.coordinateUnit = coordinateUnit
  }

  if (measurementUnit !== undefined) {
    state.measurementUnit = measurementUnit
  }

  if (shouldLoadMorphology !== undefined) {
    state.shouldLoadMorphology = shouldLoadMorphology
  }

  if (boundaryCellLimit !== undefined) {
    state.boundaryCellLimit = boundaryCellLimit
  }

  if (imageOpacity !== undefined) {
    state.imageOpacity = imageOpacity
  }

  if (cellFillOpacity !== undefined) {
    state.cellFillOpacity = cellFillOpacity
  }

  if (cellBoundaryOpacity !== undefined) {
    state.cellBoundaryOpacity = cellBoundaryOpacity
  }

  if (morphologyEnabledChannelIds !== undefined) {
    state.morphologyEnabledChannelIds = morphologyEnabledChannelIds
  }

  if (transcriptOverlay !== undefined) {
    state.transcriptOverlay = transcriptOverlay
  }

  if (transcriptDetailMode !== undefined) {
    state.transcriptDetailMode = transcriptDetailMode
  }

  if (transcriptMinQv !== undefined) {
    state.transcriptMinQv = transcriptMinQv
  }

  if (transcriptGeneOnly !== undefined) {
    state.transcriptGeneOnly = transcriptGeneOnly
  }

  if (transcriptFeatureFilterMode !== undefined) {
    state.transcriptFeatureFilterMode = transcriptFeatureFilterMode
  }

  if (transcriptDensityColorScale !== undefined) {
    state.transcriptDensityColorScale = transcriptDensityColorScale
  }

  if (transcriptPointColorMode !== undefined) {
    state.transcriptPointColorMode = transcriptPointColorMode
  }

  if (transcriptExactPointLimit !== undefined) {
    state.transcriptExactPointLimit = transcriptExactPointLimit
  }

  if (transcriptOpacity !== undefined) {
    state.transcriptOpacity = transcriptOpacity
  }

  if (transcriptPointSize !== undefined) {
    state.transcriptPointSize = transcriptPointSize
  }

  if (magicLensScope !== undefined) {
    state.magicLensScope = magicLensScope
  }

  if (magicLensActive !== undefined) {
    state.magicLensActive = magicLensActive
  }

  if (magicLensRadiusMicrometers !== undefined) {
    state.magicLensRadiusMicrometers = magicLensRadiusMicrometers
  }

  if (magicLensMinQv !== undefined) {
    state.magicLensMinQv = magicLensMinQv
  }

  return state
}

export function formatShareableState(state: ShareableState): string {
  const params = new URLSearchParams()

  params.set('xv', HASH_VERSION)

  if (state.datasetUrl !== undefined && state.datasetUrl.trim() !== '') {
    params.set('dataset', state.datasetUrl.trim())
  }

  if (state.selectedGenes !== undefined && state.selectedGenes.length > 0) {
    params.set('genes', state.selectedGenes.join(','))
  }

  if (state.viewState !== undefined) {
    params.set('view', formatViewState(state.viewState))
  }

  if (state.roiSelection !== undefined) {
    params.set('roi', formatRoiSelection(state.roiSelection))
  }

  setOptionalString(params, 'tab', state.activeTab)
  setOptionalString(params, 'scale', state.geneExpressionColorScale)
  setOptionalString(params, 'score', state.geneExpressionScoreMode)
  setOptionalString(params, 'detail', state.geneExpressionDetailMode)
  setOptionalString(params, 'cellColor', state.observationColorMode)
  setOptionalString(params, 'coord', state.coordinateUnit)
  setOptionalString(params, 'measureUnit', state.measurementUnit)

  if (state.shouldLoadMorphology !== undefined) {
    params.set('morphology', state.shouldLoadMorphology ? '1' : '0')
  }

  if (state.boundaryCellLimit !== undefined && Number.isFinite(state.boundaryCellLimit)) {
    params.set(
      'boundaryLimit',
      Math.max(1, Math.floor(state.boundaryCellLimit)).toString(),
    )
  }

  if (state.imageOpacity !== undefined && Number.isFinite(state.imageOpacity)) {
    params.set('imgOpacity', roundForHash(state.imageOpacity).toString())
  }

  if (state.cellFillOpacity !== undefined && Number.isFinite(state.cellFillOpacity)) {
    params.set('cellFill', roundForHash(state.cellFillOpacity).toString())
  }

  if (
    state.cellBoundaryOpacity !== undefined &&
    Number.isFinite(state.cellBoundaryOpacity)
  ) {
    params.set('cellBoundary', roundForHash(state.cellBoundaryOpacity).toString())
  }

  if (state.morphologyEnabledChannelIds !== undefined) {
    params.set('channels', state.morphologyEnabledChannelIds.join(','))
  }

  if (state.transcriptOverlay !== undefined) {
    params.set('tx', state.transcriptOverlay ? '1' : '0')
  }

  setOptionalString(params, 'txDetail', state.transcriptDetailMode)

  if (state.transcriptMinQv !== undefined && Number.isFinite(state.transcriptMinQv)) {
    params.set('txQv', Math.max(0, Math.floor(state.transcriptMinQv)).toString())
  }

  if (state.transcriptGeneOnly !== undefined) {
    params.set('txGene', state.transcriptGeneOnly ? '1' : '0')
  }

  setOptionalString(params, 'txFilter', state.transcriptFeatureFilterMode)
  setOptionalString(params, 'txDensity', state.transcriptDensityColorScale)
  setOptionalString(params, 'txColor', state.transcriptPointColorMode)

  if (
    state.transcriptExactPointLimit !== undefined &&
    Number.isFinite(state.transcriptExactPointLimit)
  ) {
    params.set(
      'txBudget',
      Math.max(1, Math.floor(state.transcriptExactPointLimit)).toString(),
    )
  }

  if (state.transcriptOpacity !== undefined && Number.isFinite(state.transcriptOpacity)) {
    params.set('txOpacity', roundForHash(state.transcriptOpacity).toString())
  }

  if (
    state.transcriptPointSize !== undefined &&
    Number.isFinite(state.transcriptPointSize)
  ) {
    params.set('txSize', Math.max(1, Math.floor(state.transcriptPointSize)).toString())
  }

  setOptionalString(params, 'lensScope', state.magicLensScope)

  if (state.magicLensActive !== undefined) {
    params.set('lens', state.magicLensActive ? '1' : '0')
  }

  if (
    state.magicLensRadiusMicrometers !== undefined &&
    Number.isFinite(state.magicLensRadiusMicrometers)
  ) {
    params.set(
      'lensRadius',
      Math.max(1, Math.floor(state.magicLensRadiusMicrometers)).toString(),
    )
  }

  if (state.magicLensMinQv !== undefined && Number.isFinite(state.magicLensMinQv)) {
    params.set('lensQv', Math.max(0, Math.floor(state.magicLensMinQv)).toString())
  }

  const text = params.toString()
  return text === '' ? '' : `#${text}`
}

export function viewStateToShareable(viewState: {
  readonly target: readonly [number, number, number]
  readonly zoom: number
}): ShareableViewState {
  return {
    target: [
      roundForHash(viewState.target[0] ?? 0),
      roundForHash(viewState.target[1] ?? 0),
      roundForHash(viewState.target[2] ?? 0),
    ],
    zoom: roundForHash(viewState.zoom),
  }
}

export function shareableViewStateKey(viewState: ShareableViewState | undefined): string {
  if (viewState === undefined) {
    return ''
  }

  return `${viewState.target.join(':')}:${viewState.zoom}`
}

function readString(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)
  return value === null || value.trim() === '' ? undefined : value
}

function readCsv(params: URLSearchParams, name: string): readonly string[] | undefined {
  const value = params.get(name)

  if (value === null || value.trim() === '') {
    return undefined
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return entries.length === 0 ? undefined : entries
}

function readCsvAllowEmpty(
  params: URLSearchParams,
  name: string,
): readonly string[] | undefined {
  const value = params.get(name)

  if (value === null) {
    return undefined
  }

  if (value.trim() === '') {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function setOptionalString(
  params: URLSearchParams,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined && value.trim() !== '') {
    params.set(name, value.trim())
  }
}

function parseViewState(value: string | null): ShareableViewState | undefined {
  const numbers = parseNumberList(value, 4)

  if (numbers === null) {
    return undefined
  }

  return {
    target: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    zoom: numbers[3] ?? 0,
  }
}

function formatViewState(viewState: ShareableViewState): string {
  return [viewState.target[0], viewState.target[1], viewState.target[2], viewState.zoom]
    .map(formatHashNumber)
    .join(',')
}

function parseRoiSelection(value: string | null): RoiSelection | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const [kind, encoded] = value.split(':', 2)

  if (kind === 'box') {
    const numbers = parseNumberList(encoded ?? '', 4)

    if (numbers === null) {
      return undefined
    }

    return { kind: 'box', bbox: bboxFromNumbers(numbers) }
  }

  if (kind === 'lasso') {
    const points = (encoded ?? '')
      .split(';')
      .map((point) => parseNumberList(point, 2))
      .filter((point): point is readonly [number, number] => point !== null)
      .map((point) => dataPoint(point[0], point[1]))

    if (points.length < 3) {
      return undefined
    }

    return { kind: 'lasso', bbox: bboxFromPoints(points), points }
  }

  return undefined
}

function formatRoiSelection(selection: RoiSelection): string {
  if (selection.kind === 'box') {
    return `box:${[
      selection.bbox.minX,
      selection.bbox.minY,
      selection.bbox.maxX,
      selection.bbox.maxY,
    ]
      .map(formatHashNumber)
      .join(',')}`
  }

  return `lasso:${selection.points
    .map((point) => [point.x, point.y].map(formatHashNumber).join(','))
    .join(';')}`
}

function parseNumberList(
  value: string | null,
  expectedLength: number,
): readonly number[] | null {
  if (value === null) {
    return null
  }

  const numbers = value.split(',').map((part) => Number(part))

  if (
    numbers.length !== expectedLength ||
    numbers.some((number) => !Number.isFinite(number))
  ) {
    return null
  }

  return numbers
}

function bboxFromNumbers(numbers: readonly number[]): BBox {
  return {
    minX: micrometers(Math.min(numbers[0] ?? 0, numbers[2] ?? 0)),
    minY: micrometers(Math.min(numbers[1] ?? 0, numbers[3] ?? 0)),
    maxX: micrometers(Math.max(numbers[0] ?? 0, numbers[2] ?? 0)),
    maxY: micrometers(Math.max(numbers[1] ?? 0, numbers[3] ?? 0)),
  }
}

function bboxFromPoints(points: readonly DataPoint[]): BBox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

function dataPoint(x: number, y: number): DataPoint {
  return {
    x: micrometers(x),
    y: micrometers(y),
  }
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === '1' || value === 'true') {
    return true
  }

  if (value === '0' || value === 'false') {
    return false
  }

  return undefined
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseUnitNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined
}

function roundForHash(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}

function formatHashNumber(value: number): string {
  return roundForHash(value).toString()
}
