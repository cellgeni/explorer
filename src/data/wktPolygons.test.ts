import { describe, expect, it } from 'vitest'
import { looksLikeWktPolygon, wktOuterRing } from './wktPolygons'

describe('wktOuterRing', () => {
  it('reads a polygon outer ring without its closing point', () => {
    expect(Array.from(wktOuterRing('POLYGON ((0 0, 10 0, 10 5, 0 0))') ?? [])).toEqual([
      0, 0, 10, 0, 10, 5,
    ])
  })

  it('drops holes and keeps the largest polygon of a multipolygon', () => {
    expect(
      Array.from(
        wktOuterRing(
          'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((0 0, 9 0, 9 9, 0 9, 0 0), (2 2, 3 2, 3 3, 2 2)))',
        ) ?? [],
      ),
    ).toEqual([0, 0, 9, 0, 9, 9, 0, 9])
  })

  it('reads Z and M coordinates, EWKT, exponents and lowercase keywords', () => {
    expect(
      Array.from(wktOuterRing('SRID=4326;POLYGON Z ((1 2 3, 4 5 6, 7 8 9))') ?? []),
    ).toEqual([1, 2, 4, 5, 7, 8])
    expect(
      Array.from(wktOuterRing('polygon zm((1.5e1 -2 0 0,4 5 0 0,7 8 0 0))') ?? []),
    ).toEqual([15, -2, 4, 5, 7, 8])
    expect(
      Array.from(
        wktOuterRing('POLYGON((0.1 0.2,0.30000000000000004 0.4,0.5 0.6))') ?? [],
      ),
    ).toEqual([0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6])
  })

  it('returns null for empty, other and broken geometries', () => {
    expect(wktOuterRing('POLYGON EMPTY')).toBeNull()
    expect(wktOuterRing('MULTIPOLYGON Z EMPTY')).toBeNull()
    expect(wktOuterRing('POINT (1 2)')).toBeNull()
    expect(wktOuterRing('POLYGON ((0 0, 1 0')).toBeNull()
    expect(wktOuterRing('POLYGON ((0 0, 1 1, 0 0))')).toBeNull()
  })
})

describe('looksLikeWktPolygon', () => {
  it('accepts quoted fields and SRID prefixes', () => {
    expect(looksLikeWktPolygon('"POLYGON ((0 0, 1 0, 1 1))"')).toBe(true)
    expect(looksLikeWktPolygon(' SRID=1;MULTIPOLYGON (((0 0, 1 0, 1 1)))')).toBe(true)
    expect(looksLikeWktPolygon('geometry')).toBe(false)
    expect(looksLikeWktPolygon('POLYGONS')).toBe(false)
  })
})
