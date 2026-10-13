import * as zarr from 'zarrita'
import {
  isAxisAlignedAffine,
  readElementCoordinateTransforms,
  type Affine2D,
  type SpatialDataCoordinateTransform,
} from './spatialDataTransforms'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  readConsolidatedZarrMetadata,
  type ConsolidatedZarrStore,
} from '../zarr/zarrStores'

export type SpatialDataElementKind = 'images' | 'labels' | 'points' | 'shapes' | 'tables'

export interface SpatialDataNode {
  readonly path: string
  readonly kind: 'array' | 'group'
}

export interface SpatialDataElement {
  readonly kind: SpatialDataElementKind
  readonly name: string
  readonly path: string
  readonly attrs: Readonly<Record<string, unknown>>
  readonly transforms: readonly SpatialDataCoordinateTransform[]
}

export interface SpatialDataTableInfo {
  readonly name: string
  readonly path: string
  readonly regions: readonly string[]
  readonly regionKey?: string
  readonly instanceKey?: string
}

export interface SpatialDataCatalog {
  readonly zarrFormat: 2 | 3
  readonly nodes: readonly SpatialDataNode[]
  readonly elements: readonly SpatialDataElement[]
  readonly tables: readonly SpatialDataTableInfo[]
}

export interface SpatialDataPlacedElement {
  readonly element: SpatialDataElement
  readonly affine: Affine2D
}

export interface SpatialDataView {
  readonly coordinateSystem: string
  readonly coordinateSystems: readonly string[]
  readonly image?: SpatialDataPlacedElement
  readonly table?: SpatialDataTableInfo
  // Shapes elements annotated by the table; their geometry places each row.
  readonly regionShapes: readonly SpatialDataPlacedElement[]
  // Labels elements annotated by the table; rows fall back to obsm coordinates.
  readonly regionLabels: readonly SpatialDataPlacedElement[]
  // Polygon shapes that can replace circle regions as drawn boundaries, such as
  // Xenium `cell_boundaries` sharing the `cell_circles` index.
  readonly boundaryCandidates: readonly SpatialDataPlacedElement[]
  readonly skippedElements: readonly SpatialDataElement[]
}

export type SpatialDataStore = ConsolidatedZarrStore

export class SpatialDataConsolidatedMetadataError extends Error {
  readonly url: string

  constructor(url: string) {
    super(
      'SpatialData store does not expose consolidated Zarr metadata (zmetadata, .zmetadata, or zarr.json consolidated_metadata). Re-write it with consolidated metadata so the browser can list its elements.',
    )
    this.name = 'SpatialDataConsolidatedMetadataError'
    this.url = url
  }
}

const ELEMENT_KINDS: readonly SpatialDataElementKind[] = [
  'images',
  'labels',
  'points',
  'shapes',
  'tables',
]

// Compressed chunk bytes kept per store so repeated expression reads (for
// example switching genes on a CSR table) do not refetch matrix chunks.
const CHUNK_CACHE_MAX_BYTES = 256 * 1024 * 1024

const SPATIALDATA_ELEMENT_ATTRIBUTE_KEYS = [
  'coordinateTransformations',
  'encoding-type',
  'multiscales',
  'ome',
] as const

const BOUNDARY_SHAPES_NAME_PATTERN =
  /(?:^|[_-])cell[_-]?(?:boundar|segmentation|polygon)/i

// Root attributes carry `spatialdata_attrs`. Elements (images, labels, shapes,
// points, tables) can carry it too, so element-only keys rule a group out.
export function isSpatialDataRootMetadata(value: unknown): boolean {
  const record = recordOrNull(value)
  const attrs = recordOrNull(record?.attributes) ?? record

  if (attrs === null || recordOrNull(attrs.spatialdata_attrs) === null) {
    return false
  }

  return !SPATIALDATA_ELEMENT_ATTRIBUTE_KEYS.some((key) => key in attrs)
}

export async function openSpatialDataStore(
  url: string,
  options: { readonly fetcher?: typeof fetch } = {},
): Promise<{ readonly store: SpatialDataStore; readonly zarrFormat: 2 | 3 }> {
  const base = createZarrFetchStore(url, options)
  const consolidated = await readConsolidatedZarrMetadata(base)

  if (consolidated === null) {
    throw new SpatialDataConsolidatedMetadataError(url)
  }

  return {
    store: consolidatedZarrStore(base, consolidated.knownMetadata, {
      chunkCacheMaxBytes: CHUNK_CACHE_MAX_BYTES,
    }),
    zarrFormat: consolidated.zarrFormat,
  }
}

export async function readSpatialDataCatalog(
  store: SpatialDataStore,
  zarrFormat: 2 | 3,
): Promise<SpatialDataCatalog> {
  const nodes = store.contents().map((node) => ({
    path: node.path.replace(/^\/+/, ''),
    kind: node.kind,
  }))
  const elements: SpatialDataElement[] = []

  for (const node of nodes) {
    const [kind, name, ...rest] = node.path.split('/')

    if (
      node.kind !== 'group' ||
      rest.length > 0 ||
      name === undefined ||
      name.length === 0 ||
      !isElementKind(kind)
    ) {
      continue
    }

    const attrs = await readGroupAttrs(store, zarrFormat, node.path)
    elements.push({
      kind,
      name,
      path: node.path,
      attrs,
      transforms: kind === 'tables' ? [] : readElementCoordinateTransforms(attrs),
    })
  }

  elements.sort(
    (left, right) =>
      ELEMENT_KINDS.indexOf(left.kind) - ELEMENT_KINDS.indexOf(right.kind) ||
      left.name.localeCompare(right.name),
  )

  return {
    zarrFormat,
    nodes,
    elements,
    tables: elements
      .filter((element) => element.kind === 'tables')
      .map((element) => tableInfoFromElement(element)),
  }
}

export function selectSpatialDataView(
  catalog: SpatialDataCatalog,
  options: { readonly coordinateSystem?: string } = {},
): SpatialDataView {
  const spatialElements = catalog.elements.filter((element) => element.kind !== 'tables')
  const elementsByName = new Map(
    spatialElements.map((element) => [element.name, element]),
  )
  const table = primaryTable(catalog.tables, elementsByName)
  const regionElements = (table?.regions ?? [])
    .map((region) => elementsByName.get(region))
    .filter((element): element is SpatialDataElement => element !== undefined)
  const coordinateSystems = uniqueInOrder(
    [...regionElements, ...spatialElements].flatMap((element) =>
      element.transforms.map((transform) => transform.coordinateSystem),
    ),
  )
  const coordinateSystem =
    options.coordinateSystem !== undefined &&
    coordinateSystems.includes(options.coordinateSystem)
      ? options.coordinateSystem
      : bestCoordinateSystem(coordinateSystems, spatialElements, regionElements)

  if (coordinateSystem === undefined) {
    throw new Error('SpatialData store does not declare any coordinate systems.')
  }

  const place = (element: SpatialDataElement): SpatialDataPlacedElement | null => {
    const transform = element.transforms.find(
      (candidate) => candidate.coordinateSystem === coordinateSystem,
    )
    return transform === undefined ? null : { element, affine: transform.affine }
  }
  const placed = spatialElements
    .map(place)
    .filter((entry): entry is SpatialDataPlacedElement => entry !== null)
  const regionNames = new Set(regionElements.map((element) => element.name))
  const regionShapes = placed.filter(
    (entry) => entry.element.kind === 'shapes' && regionNames.has(entry.element.name),
  )
  const regionLabels = placed.filter(
    (entry) => entry.element.kind === 'labels' && regionNames.has(entry.element.name),
  )
  const image = placed
    .filter(
      (entry) => entry.element.kind === 'images' && isAxisAlignedAffine(entry.affine),
    )
    .sort((left, right) => left.affine.a - right.affine.a)[0]
  const boundaryCandidates = placed.filter(
    (entry) =>
      entry.element.kind === 'shapes' &&
      !regionNames.has(entry.element.name) &&
      BOUNDARY_SHAPES_NAME_PATTERN.test(entry.element.name),
  )
  const usedElements = new Set<SpatialDataElement>([
    ...regionShapes.map((entry) => entry.element),
    ...regionLabels.map((entry) => entry.element),
    ...boundaryCandidates.map((entry) => entry.element),
    ...(image === undefined ? [] : [image.element]),
  ])

  return {
    coordinateSystem,
    coordinateSystems,
    ...(image === undefined ? {} : { image }),
    ...(table === undefined ? {} : { table }),
    regionShapes,
    regionLabels,
    boundaryCandidates,
    skippedElements: spatialElements.filter((element) => !usedElements.has(element)),
  }
}

function primaryTable(
  tables: readonly SpatialDataTableInfo[],
  elementsByName: ReadonlyMap<string, SpatialDataElement>,
): SpatialDataTableInfo | undefined {
  const annotatesKind = (table: SpatialDataTableInfo, kind: SpatialDataElementKind) =>
    table.regions.some((region) => elementsByName.get(region)?.kind === kind)

  return (
    tables.find((table) => annotatesKind(table, 'shapes')) ??
    tables.find((table) => annotatesKind(table, 'labels')) ??
    tables[0]
  )
}

function bestCoordinateSystem(
  coordinateSystems: readonly string[],
  elements: readonly SpatialDataElement[],
  regionElements: readonly SpatialDataElement[],
): string | undefined {
  const inSystem = (element: SpatialDataElement, system: string) =>
    element.transforms.some((transform) => transform.coordinateSystem === system)
  const scored = coordinateSystems.map((system, order) => ({
    system,
    order,
    regions: regionElements.filter((element) => inSystem(element, system)).length,
    images: elements.some(
      (element) => element.kind === 'images' && inSystem(element, system),
    )
      ? 1
      : 0,
    elements: elements.filter((element) => inSystem(element, system)).length,
    global: system === 'global' ? 1 : 0,
  }))

  scored.sort(
    (left, right) =>
      right.regions - left.regions ||
      right.images - left.images ||
      right.elements - left.elements ||
      right.global - left.global ||
      left.order - right.order,
  )

  return scored[0]?.system
}

function tableInfoFromElement(element: SpatialDataElement): SpatialDataTableInfo {
  const attrs = recordOrNull(element.attrs.spatialdata_attrs) ?? element.attrs
  const region = attrs.region
  const regions =
    typeof region === 'string'
      ? [region]
      : Array.isArray(region)
        ? region.filter((item): item is string => typeof item === 'string')
        : []

  return {
    name: element.name,
    path: element.path,
    regions,
    ...(typeof attrs.region_key === 'string' ? { regionKey: attrs.region_key } : {}),
    ...(typeof attrs.instance_key === 'string'
      ? { instanceKey: attrs.instance_key }
      : {}),
  }
}

async function readGroupAttrs(
  store: SpatialDataStore,
  zarrFormat: 2 | 3,
  path: string,
): Promise<Readonly<Record<string, unknown>>> {
  const location = zarr.root(store).resolve(path)
  const group =
    zarrFormat === 3
      ? await zarr.open.v3(location, { kind: 'group' })
      : await zarr.open.v2(location, { kind: 'group' })

  return group.attrs
}

function isElementKind(value: string | undefined): value is SpatialDataElementKind {
  return ELEMENT_KINDS.includes(value as SpatialDataElementKind)
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values))
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
