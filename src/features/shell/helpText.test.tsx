import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  testCellsSectionModel,
  testDatasetInfoModel,
  testTranscriptsSectionModel,
} from '../../test/sectionModels'
import {
  ExpressionDetailControl,
  GeneExpressionControls,
} from '../sections/CellsSectionBlocks'
import { BoundaryLimitField, OpenDatasetForm } from '../sections/DatasetInfoBlocks'
import {
  TranscriptDisplayControls,
  TranscriptFilterControls,
} from '../sections/TranscriptsSectionBlocks'
import {
  BOUNDARY_LIMIT_HELP,
  COMBINE_GENES_HELP,
  EXPRESSION_DETAIL_HELP,
  MIN_QV_HELP,
  TRANSCRIPT_DETAIL_HELP,
} from './helpText'

// The info tips of 15.3-B: LOD (cells and transcripts), QV, Boundary limit
// and Combine genes.
describe('info tips', () => {
  it('explain the level of detail and how genes combine', () => {
    const { colour } = testCellsSectionModel()
    render(
      <>
        <GeneExpressionControls colour={{ ...colour, selectedGeneCount: 2 }} />
        <ExpressionDetailControl colour={colour} />
      </>,
    )

    expect(
      screen.getByRole('button', { name: 'About Combine genes' }),
    ).toHaveAccessibleDescription(COMBINE_GENES_HELP)
    expect(
      screen.getByRole('button', { name: 'About Expression detail' }),
    ).toHaveAccessibleDescription(EXPRESSION_DETAIL_HELP)
    // The tips sit beside the labels, which still name their controls.
    expect(screen.getByRole('combobox', { name: 'Combine genes' })).toBeInTheDocument()
  })

  it('explain transcript detail and QV', () => {
    const transcripts = testTranscriptsSectionModel()
    render(
      <>
        <TranscriptDisplayControls transcripts={transcripts} />
        <TranscriptFilterControls transcripts={transcripts} />
      </>,
    )

    expect(
      screen.getByRole('button', { name: 'About Transcript detail' }),
    ).toHaveAccessibleDescription(TRANSCRIPT_DETAIL_HELP)
    expect(
      screen.getByRole('button', { name: 'About Min QV' }),
    ).toHaveAccessibleDescription(MIN_QV_HELP)
    expect(screen.getByRole('spinbutton', { name: 'Min QV' })).toBeInTheDocument()
  })

  it('explain the boundary limit in Settings and under Advanced', () => {
    const { open } = testDatasetInfoModel()
    render(
      <>
        <BoundaryLimitField open={open} />
        <OpenDatasetForm open={open} boundaryLimit="advanced" />
      </>,
    )

    const tips = screen.getAllByRole('button', { name: 'About Boundary limit' })
    expect(tips).toHaveLength(2)
    for (const tip of tips) expect(tip).toHaveAccessibleDescription(BOUNDARY_LIMIT_HELP)
  })
})
