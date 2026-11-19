import { describe, expect, it } from 'vitest'
import { createGeojsonFeatureStream } from './geojsonFeatureStream'

function readInPieces(text: string, size: number): unknown[] {
  const features: unknown[] = []
  const stream = createGeojsonFeatureStream(
    (feature) => {
      features.push(feature)
    },
    { label: 'test' },
  )

  for (let start = 0; start < text.length; start += size) {
    stream.push(text.slice(start, start + size))
  }

  stream.finish()
  return features
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

describe('createGeojsonFeatureStream', () => {
  const features = [
    { type: 'Feature', id: 'a', properties: { name: 'x "quoted" ]}' } },
    { type: 'Feature', id: 'b', properties: {} },
  ]

  it('reads a FeatureCollection in any pieces', () => {
    const text = JSON.stringify({ type: 'FeatureCollection', features })

    for (const size of [1, 3, 7, 1000]) {
      expect(readInPieces(text, size)).toEqual(features)
    }
  })

  it('reads a bare array of features, as QuPath exports them', () => {
    expect(readInPieces(`${BYTE_ORDER_MARK}  ${JSON.stringify(features)}`, 5)).toEqual(
      features,
    )
  })

  it('reports a file that is not a FeatureCollection or ends early', () => {
    expect(() => readInPieces('{"type":"Feature"}', 4)).toThrow(
      'Expected test GeoJSON to be a FeatureCollection.',
    )
    expect(() =>
      readInPieces('{"type":"FeatureCollection","features":[{"a":1}', 4),
    ).toThrow('Unexpected end of test GeoJSON feature stream.')
    expect(() => readInPieces('{"features":{}}', 4)).toThrow(
      'Expected test GeoJSON features to be an array.',
    )
  })
})
