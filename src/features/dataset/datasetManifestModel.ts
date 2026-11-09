import type { ShareableState } from '../../data/shareableState'
import type { DatasetManifestDefaults } from '../../datasets/datasetManifest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import { parseObservationColorMode } from '../app-shell/appShellModel'
import {
  parseGeneExpressionColorScale,
  parseGeneExpressionScoreMode,
} from '../genes/geneControlsModel'

export interface ManifestDefaultsState {
  // The manifest defaults as the share-URL fields the lifecycle restores.
  readonly state: ShareableState
  // Defaults that were dropped because the value is not one the control has.
  readonly ignored: readonly string[]
}

// Maps a manifest's `defaults` onto share-URL fields, so they follow the same
// restore path as a shared link (which takes precedence over them).
export function manifestDefaultsToShareableState(
  defaults: DatasetManifestDefaults | undefined,
): ManifestDefaultsState {
  if (defaults === undefined) {
    return { state: {}, ignored: [] }
  }

  const ignored: string[] = []
  const enumValue = <Value extends string>(
    key: keyof DatasetManifestDefaults,
    value: string | undefined,
    parse: (value: string | undefined) => Value | undefined,
  ): Value | undefined => {
    if (value === undefined) {
      return undefined
    }

    const parsed = parse(value)

    if (parsed === undefined) {
      ignored.push(`defaults.${key} "${value}" is not a known value`)
    }

    return parsed
  }

  const observationColorMode = enumValue(
    'colorCellsBy',
    defaults.colorCellsBy,
    parseObservationColorMode,
  )
  const geneExpressionColorScale = enumValue(
    'geneColorScale',
    defaults.geneColorScale,
    parseGeneExpressionColorScale,
  )
  const geneExpressionScoreMode = enumValue(
    'geneScoreMode',
    defaults.geneScoreMode,
    parseGeneExpressionScoreMode,
  )

  const fields: {
    readonly [Key in keyof ShareableState]: ShareableState[Key] | undefined
  } = {
    selectedGenes: defaults.genes,
    observationColorMode,
    geneExpressionColorScale,
    geneExpressionScoreMode,
    showCellBoundaries: defaults.cellBoundaries,
    showNucleusBoundaries: defaults.nucleusBoundaries,
    morphologyEnabledChannelIds: defaults.channels,
    imageOpacity: defaults.imageOpacity,
    cellFillOpacity: defaults.cellFillOpacity,
    cellBoundaryOpacity: defaults.cellBoundaryOpacity,
    transcriptOverlay: defaults.transcripts,
  }
  const state = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as ShareableState

  return { state, ignored }
}

// Fields of `defaults` that a shared link for the same dataset does not set.
export function manifestDefaultsNotShared(
  defaults: ShareableState,
  shared: ShareableState | null,
): ShareableState {
  if (shared === null) {
    return defaults
  }

  return Object.fromEntries(
    Object.entries(defaults).filter(
      ([key]) => shared[key as keyof ShareableState] === undefined,
    ),
  )
}

// Channel IDs to enable for a selection of IDs (share URLs) or names
// (manifests; case-insensitive). A non-empty selection that matches nothing
// falls back to `fallbackIds`; an empty one turns every channel off.
export function resolveMorphologyChannelSelection(
  channels: readonly MorphologyImageChannel[],
  selection: readonly string[],
  fallbackIds: readonly string[] | undefined,
): readonly string[] | undefined {
  if (selection.length === 0) {
    return []
  }

  const ids = channels
    .filter((channel) =>
      selection.some(
        (selector) =>
          selector === channel.info.id ||
          selector.toLowerCase() === channel.info.name.toLowerCase(),
      ),
    )
    .map((channel) => channel.info.id)

  return ids.length === 0 ? fallbackIds : ids
}
