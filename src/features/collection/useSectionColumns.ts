import { useEffect, useState } from 'react'
import {
  parseAnnDataSectionUrl,
  type AnnDataSectionColumn,
} from '../../datasets/annDataSections'
import { isSplittableAnnData } from '../../datasets/annDataSectionCollection'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'

const NO_COLUMNS: readonly AnnDataSectionColumn[] = []

// The obs columns that split an AnnData table opened whole, read from the
// loaded dataset once it is ready, for the `Open N Sections` link. None for
// a section, a table in a collection, or another platform.
export function useSectionColumns({
  datasetUrl,
  enabled,
  getSpatialDataset,
}: {
  readonly datasetUrl: string | null
  readonly enabled: boolean
  readonly getSpatialDataset: SpatialDatasetLoader
}): readonly AnnDataSectionColumn[] {
  const [read, setRead] = useState<{
    readonly url: string
    readonly columns: readonly AnnDataSectionColumn[]
  } | null>(null)
  const url =
    enabled && datasetUrl !== null && parseAnnDataSectionUrl(datasetUrl) === null
      ? datasetUrl
      : null

  useEffect(() => {
    if (url === null) return

    let active = true
    const done = (columns: readonly AnnDataSectionColumn[]) => {
      if (active) setRead({ url, columns })
    }

    getSpatialDataset(url)
      .then((dataset) => (isSplittableAnnData(dataset) ? dataset.sectionColumns() : []))
      // Without its columns the table is offered no link.
      .then(done, () => {
        done(NO_COLUMNS)
      })

    return () => {
      active = false
    }
  }, [getSpatialDataset, url])

  return read !== null && read.url === url ? read.columns : NO_COLUMNS
}
