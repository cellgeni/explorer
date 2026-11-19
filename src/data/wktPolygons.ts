// Well-known text (WKT) polygons, as shapely, GeoPandas, PostGIS and QuPath
// write them: POLYGON and MULTIPOLYGON, 2D to 4D, with an optional EWKT
// `SRID=n;` prefix. Only x and y are kept, and only outer rings, as for
// SpatialData shapes: holes are dropped, and a MULTIPOLYGON keeps its largest
// polygon.

const WKT_KEYWORD = /^\s*"?\s*(?:SRID=\d+;)?\s*(?:MULTI)?POLYGON\b/i
const POW10 = Array.from({ length: 23 }, (_value, exponent) => 10 ** exponent)

// Whether `text` starts like a WKT polygon (a quote before it is allowed, as
// in a CSV field).
export function looksLikeWktPolygon(text: string): boolean {
  return WKT_KEYWORD.test(text)
}

// The outer ring of a WKT POLYGON, or of a MULTIPOLYGON's largest polygon, as
// interleaved x, y. Null for EMPTY, other geometry types, and text that is not
// WKT.
export function wktOuterRing(text: string): Float64Array | null {
  const scanner: WktScanner = { text, cursor: 0 }

  try {
    return readGeometry(scanner)
  } catch {
    return null
  }
}

interface WktScanner {
  readonly text: string
  cursor: number
}

function readGeometry(scanner: WktScanner): Float64Array | null {
  skipSpace(scanner)

  if (scanner.text.startsWith('SRID=', scanner.cursor)) {
    const end = scanner.text.indexOf(';', scanner.cursor)

    if (end < 0) {
      return null
    }

    scanner.cursor = end + 1
    skipSpace(scanner)
  }

  const keyword = readWord(scanner).toUpperCase()

  if (keyword !== 'POLYGON' && keyword !== 'MULTIPOLYGON') {
    return null
  }

  skipSpace(scanner)
  let dimensions = 2
  const next = peekWord(scanner).toUpperCase()

  if (next === 'Z' || next === 'M') {
    dimensions = 3
    readWord(scanner)
  } else if (next === 'ZM') {
    dimensions = 4
    readWord(scanner)
  } else if (next === 'EMPTY') {
    return null
  }

  skipSpace(scanner)

  if (peekWord(scanner).toUpperCase() === 'EMPTY') {
    return null
  }

  if (keyword === 'POLYGON') {
    return readPolygonOuterRing(scanner, dimensions)
  }

  expect(scanner, '(')
  let largest: Float64Array | null = null
  let largestArea = -1

  for (;;) {
    skipSpace(scanner)

    if (peekWord(scanner).toUpperCase() === 'EMPTY') {
      readWord(scanner)
    } else {
      const ring = readPolygonOuterRing(scanner, dimensions)
      const area = ring === null ? -1 : Math.abs(signedArea(ring))

      if (ring !== null && area > largestArea) {
        largest = ring
        largestArea = area
      }
    }

    skipSpace(scanner)

    if (consume(scanner, ',')) {
      continue
    }

    expect(scanner, ')')
    return largest
  }
}

// `((x y, ...), (hole), ...)`: the first ring, with the holes skipped.
function readPolygonOuterRing(
  scanner: WktScanner,
  dimensions: number,
): Float64Array | null {
  expect(scanner, '(')
  const outer = readRing(scanner, dimensions)
  skipSpace(scanner)

  while (consume(scanner, ',')) {
    skipRing(scanner)
    skipSpace(scanner)
  }

  expect(scanner, ')')
  return outer.length >= 6 ? outer : null
}

function readRing(scanner: WktScanner, dimensions: number): Float64Array {
  expect(scanner, '(')
  let values = new Float64Array(64)
  let length = 0

  for (;;) {
    for (let axis = 0; axis < dimensions; axis += 1) {
      skipSpace(scanner)
      const value = readNumber(scanner)

      if (axis < 2) {
        if (length === values.length) {
          const grown = new Float64Array(values.length * 2)
          grown.set(values)
          values = grown
        }

        values[length] = value
        length += 1
      }
    }

    skipSpace(scanner)

    if (consume(scanner, ',')) {
      continue
    }

    expect(scanner, ')')
    break
  }

  // A closed ring repeats its first point last; outlines do not need it.
  if (
    length >= 4 &&
    values[0] === values[length - 2] &&
    values[1] === values[length - 1]
  ) {
    length -= 2
  }

  return values.slice(0, length)
}

function skipRing(scanner: WktScanner): void {
  expect(scanner, '(')
  const end = scanner.text.indexOf(')', scanner.cursor)

  if (end < 0) {
    throw new Error('Unclosed WKT ring.')
  }

  scanner.cursor = end + 1
}

// A decimal number. Mantissas of up to 15 digits are built exactly and
// scaled once, which rounds correctly; longer ones go to Number.
function readNumber(scanner: WktScanner): number {
  const { text } = scanner
  const start = scanner.cursor
  let cursor = start
  let negative = false

  if (text.charCodeAt(cursor) === 45 /* - */) {
    negative = true
    cursor += 1
  } else if (text.charCodeAt(cursor) === 43 /* + */) {
    cursor += 1
  }

  let mantissa = 0
  let digits = 0
  let fractionDigits = 0
  let code = text.charCodeAt(cursor)

  while (code >= 48 && code <= 57) {
    mantissa = mantissa * 10 + (code - 48)
    digits += 1
    cursor += 1
    code = text.charCodeAt(cursor)
  }

  if (code === 46 /* . */) {
    cursor += 1
    code = text.charCodeAt(cursor)

    while (code >= 48 && code <= 57) {
      mantissa = mantissa * 10 + (code - 48)
      digits += 1
      fractionDigits += 1
      cursor += 1
      code = text.charCodeAt(cursor)
    }
  }

  if (digits === 0) {
    throw new Error(`Expected a number at ${start.toString()}.`)
  }

  let exponent = 0

  if (code === 101 /* e */ || code === 69 /* E */) {
    cursor += 1
    let exponentNegative = false
    code = text.charCodeAt(cursor)

    if (code === 45 || code === 43) {
      exponentNegative = code === 45
      cursor += 1
      code = text.charCodeAt(cursor)
    }

    let exponentDigits = 0

    while (code >= 48 && code <= 57) {
      exponent = exponent * 10 + (code - 48)
      exponentDigits += 1
      cursor += 1
      code = text.charCodeAt(cursor)
    }

    if (exponentDigits === 0) {
      throw new Error(`Expected an exponent at ${cursor.toString()}.`)
    }

    exponent = exponentNegative ? -exponent : exponent
  }

  scanner.cursor = cursor
  const scale = exponent - fractionDigits

  if (digits > 15 || Math.abs(scale) > 22) {
    return Number(text.slice(start, cursor))
  }

  const magnitude =
    scale >= 0 ? mantissa * (POW10[scale] ?? 1) : mantissa / (POW10[-scale] ?? 1)
  return negative ? -magnitude : magnitude
}

function readWord(scanner: WktScanner): string {
  const start = scanner.cursor
  let cursor = start
  let code = scanner.text.charCodeAt(cursor)

  while ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
    cursor += 1
    code = scanner.text.charCodeAt(cursor)
  }

  scanner.cursor = cursor
  return scanner.text.slice(start, cursor)
}

function peekWord(scanner: WktScanner): string {
  const cursor = scanner.cursor
  const word = readWord(scanner)
  scanner.cursor = cursor
  return word
}

function skipSpace(scanner: WktScanner): void {
  let code = scanner.text.charCodeAt(scanner.cursor)

  while (code === 32 || code === 9 || code === 10 || code === 13) {
    scanner.cursor += 1
    code = scanner.text.charCodeAt(scanner.cursor)
  }
}

function consume(scanner: WktScanner, char: string): boolean {
  if (scanner.text[scanner.cursor] === char) {
    scanner.cursor += 1
    return true
  }

  return false
}

function expect(scanner: WktScanner, char: string): void {
  skipSpace(scanner)

  if (!consume(scanner, char)) {
    throw new Error(`Expected "${char}" at ${scanner.cursor.toString()}.`)
  }
}

function signedArea(ring: Float64Array): number {
  let area = 0

  for (let index = 0; index < ring.length; index += 2) {
    const next = (index + 2) % ring.length
    area +=
      (ring[index] ?? 0) * (ring[next + 1] ?? 0) -
      (ring[next] ?? 0) * (ring[index + 1] ?? 0)
  }

  return area / 2
}
