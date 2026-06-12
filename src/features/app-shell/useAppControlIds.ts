import { useId } from 'react'

export interface AppControlIds {
  readonly datasetInputId: string
  readonly morphologyInputId: string
  readonly boundaryLimitInputId: string
  readonly imageOpacityInputId: string
  readonly cellFillOpacityInputId: string
  readonly cellBoundaryOpacityInputId: string
  readonly coordinateUnitInputId: string
  readonly measurementModeInputId: string
  readonly measurementUnitInputId: string
  readonly geneSearchInputId: string
  readonly geneSetSymbolsInputId: string
  readonly geneSetNameInputId: string
  readonly geneSetScoreInputId: string
  readonly geneScaleInputId: string
  readonly geneExpressionDetailInputId: string
  readonly annotationImportInputId: string
  readonly annotationImportUrlInputId: string
  readonly annotationGroupInputId: string
  readonly cellMetadataTrackInputId: string
  readonly embeddingViewInputId: string
  readonly roiNameInputId: string
  readonly observationModeInputId: string
  readonly transcriptDetailInputId: string
  readonly transcriptDensityScaleInputId: string
  readonly transcriptPointColorInputId: string
  readonly transcriptPointBudgetInputId: string
  readonly transcriptMinQvInputId: string
  readonly transcriptFeatureFilterInputId: string
  readonly transcriptFeatureSearchInputId: string
  readonly transcriptOpacityInputId: string
  readonly transcriptPointSizeInputId: string
  readonly magicLensScopeInputId: string
  readonly magicLensRadiusInputId: string
  readonly magicLensMinQvInputId: string
}

export function useAppControlIds(): AppControlIds {
  return {
    datasetInputId: useId(),
    morphologyInputId: useId(),
    boundaryLimitInputId: useId(),
    imageOpacityInputId: useId(),
    cellFillOpacityInputId: useId(),
    cellBoundaryOpacityInputId: useId(),
    coordinateUnitInputId: useId(),
    measurementModeInputId: useId(),
    measurementUnitInputId: useId(),
    geneSearchInputId: useId(),
    geneSetSymbolsInputId: useId(),
    geneSetNameInputId: useId(),
    geneSetScoreInputId: useId(),
    geneScaleInputId: useId(),
    geneExpressionDetailInputId: useId(),
    annotationImportInputId: useId(),
    annotationImportUrlInputId: useId(),
    annotationGroupInputId: useId(),
    cellMetadataTrackInputId: useId(),
    embeddingViewInputId: useId(),
    roiNameInputId: useId(),
    observationModeInputId: useId(),
    transcriptDetailInputId: useId(),
    transcriptDensityScaleInputId: useId(),
    transcriptPointColorInputId: useId(),
    transcriptPointBudgetInputId: useId(),
    transcriptMinQvInputId: useId(),
    transcriptFeatureFilterInputId: useId(),
    transcriptFeatureSearchInputId: useId(),
    transcriptOpacityInputId: useId(),
    transcriptPointSizeInputId: useId(),
    magicLensScopeInputId: useId(),
    magicLensRadiusInputId: useId(),
    magicLensMinQvInputId: useId(),
  }
}
