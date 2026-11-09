import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHostResponses,
  likelyMissingFileError,
  noteReadableResponse,
} from './hostResponses'

const URL_ON_HOST = 'https://ftp.example.test/run-1/morphology_focus/ch0000.ome.tif'

afterEach(() => {
  clearHostResponses()
})

describe('failed requests on hosts that hide error responses', () => {
  it('reports a failed fetch as a likely missing file once the host has answered', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)
    const cause = new TypeError('Failed to fetch')

    expect(likelyMissingFileError('ch0000.ome.tif', URL_ON_HOST, cause)).toMatchObject({
      name: 'LikelyMissingFileError',
      message: expect.stringContaining(
        `ch0000.ome.tif could not be read. The request for ${URL_ON_HOST} failed without a readable response, although other files on ftp.example.test were readable, so the file is most likely missing.`,
      ),
      cause,
    })
  })

  it('keeps the original error for hosts that never answered', () => {
    expect(
      likelyMissingFileError(
        'ch0000.ome.tif',
        URL_ON_HOST,
        new TypeError('Failed to fetch'),
      ),
    ).toBeUndefined()
  })

  it('keeps the original error for hosts that send CORS headers with errors', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)
    noteReadableResponse('https://ftp.example.test/run-1/explorer.json', 404)

    expect(
      likelyMissingFileError(
        'ch0000.ome.tif',
        URL_ON_HOST,
        new TypeError('Failed to fetch'),
      ),
    ).toBeUndefined()
  })

  it('keeps errors that are not failed fetches', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)

    expect(
      likelyMissingFileError('ch0000.ome.tif', URL_ON_HOST, new Error('decode failed')),
    ).toBeUndefined()
  })
})
