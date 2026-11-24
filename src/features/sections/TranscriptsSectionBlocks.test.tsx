import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testTranscriptsSectionModel } from '../../test/sectionModels'
import {
  TranscriptFeatureControls,
  TranscriptFilterControls,
} from './TranscriptsSectionBlocks'

describe('TranscriptFilterControls', () => {
  function renderMinQv() {
    const transcripts = testTranscriptsSectionModel()
    render(<TranscriptFilterControls transcripts={transcripts} />)
    return {
      transcripts,
      input: screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Min QV' }),
    }
  }

  it('applies Min QV on Enter, not each keystroke', () => {
    const { transcripts, input } = renderMinQv()

    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.change(input, { target: { value: '35' } })
    expect(transcripts.onMinQvChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(transcripts.onMinQvChange).toHaveBeenCalledTimes(1)
    expect(transcripts.onMinQvChange).toHaveBeenCalledWith(35)
  })

  it('applies Min QV when the field is left, and keeps it when left empty', () => {
    const { transcripts, input } = renderMinQv()

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    fireEvent.blur(input)
    expect(transcripts.onMinQvChange).not.toHaveBeenCalled()
    expect(input.value).toBe('20')

    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    expect(transcripts.onMinQvChange).toHaveBeenCalledWith(12)
  })

  it('puts Min QV back on Esc', () => {
    const { transcripts, input } = renderMinQv()

    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('20')
    fireEvent.blur(input)

    expect(transcripts.onMinQvChange).not.toHaveBeenCalled()
  })
})

describe('TranscriptFeatureControls', () => {
  it('names its chips and search results as groups', () => {
    const { features } = testTranscriptsSectionModel({
      features: { options: ['GFAP', 'SNAP25'], selected: ['GFAP'] },
    })
    render(<TranscriptFeatureControls features={features} />)

    expect(
      screen.getByRole('group', { name: 'Transcript selected features' }),
    ).toHaveTextContent('GFAP')
    fireEvent.change(screen.getByRole('searchbox', { name: /feature/i }), {
      target: { value: 'SNAP' },
    })
    expect(
      screen.getByRole('group', { name: 'Transcript feature options' }),
    ).toHaveTextContent('SNAP25')
  })
})
