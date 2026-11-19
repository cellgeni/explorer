// Reads the features of a GeoJSON FeatureCollection as its text arrives, one
// JSON.parse per feature, so a file of hundreds of megabytes is never held as
// one string or one object tree. A bare array of features, as QuPath exports
// objects, is read the same way.

export interface GeojsonFeatureStream {
  // Adds the next piece of text and reports the features it completes.
  push(text: string): void
  // Throws when the text ended before the features did.
  finish(): void
}

export type GeojsonFeatureHandler = (feature: unknown, featureIndex: number) => void

interface GeojsonFeatureScanner {
  buffer: string
  featureIndex: number
  mode: 'find-features' | 'read-features' | 'done'
}

interface JsonStringToken {
  readonly value: string
  readonly end: number
}

// `label` names the file in errors, as in "Expected <label> GeoJSON to be a
// FeatureCollection."
export function createGeojsonFeatureStream(
  onFeature: GeojsonFeatureHandler,
  options: { readonly label: string },
): GeojsonFeatureStream {
  const scanner: GeojsonFeatureScanner = {
    buffer: '',
    featureIndex: 0,
    mode: 'find-features',
  }

  return {
    push(text) {
      if (scanner.mode === 'done') {
        return
      }

      scanner.buffer += text
      drainScanner(scanner, onFeature, options.label)
    },
    finish() {
      drainScanner(scanner, onFeature, options.label)
      assertScannerComplete(scanner, options.label)
    },
  }
}

function assertScannerComplete(scanner: GeojsonFeatureScanner, label: string): void {
  if (scanner.mode === 'find-features') {
    throw new Error(`Expected ${label} GeoJSON to be a FeatureCollection.`)
  }

  if (scanner.mode !== 'done') {
    throw new Error(`Unexpected end of ${label} GeoJSON feature stream.`)
  }
}

function drainScanner(
  scanner: GeojsonFeatureScanner,
  onFeature: GeojsonFeatureHandler,
  label: string,
): void {
  if (scanner.mode === 'find-features') {
    const featuresStart = findFeaturesArrayStart(scanner.buffer, label)

    if (featuresStart === null) {
      return
    }

    scanner.buffer = scanner.buffer.slice(featuresStart)
    scanner.mode = 'read-features'
  }

  // Features are read from a cursor, and the buffer is cut once at the end.
  const { buffer } = scanner
  let cursor = 0

  while (scanner.mode === 'read-features') {
    const valueStart = skipJsonWhitespace(buffer, cursor)

    if (valueStart >= buffer.length) {
      cursor = valueStart
      break
    }

    const nextChar = buffer[valueStart]

    if (nextChar === ']') {
      cursor = valueStart + 1
      scanner.mode = 'done'
      break
    }

    if (nextChar === ',') {
      cursor = valueStart + 1
      continue
    }

    if (nextChar !== '{') {
      throw new Error(
        `Expected ${label} GeoJSON feature ${scanner.featureIndex} to be an object.`,
      )
    }

    const valueEnd = findJsonObjectEnd(buffer, valueStart)

    if (valueEnd === null) {
      cursor = valueStart
      break
    }

    onFeature(
      JSON.parse(buffer.slice(valueStart, valueEnd)) as unknown,
      scanner.featureIndex,
    )
    scanner.featureIndex += 1
    cursor = valueEnd
  }

  scanner.buffer = buffer.slice(cursor)
}

// Where the features begin: after the `[` of the top-level `features` key,
// or of a top-level array. Null until the buffer holds it.
function findFeaturesArrayStart(buffer: string, label: string): number | null {
  const first = skipJsonWhitespace(buffer, buffer.charCodeAt(0) === 0xfeff ? 1 : 0)

  if (buffer[first] === '[') {
    return first + 1
  }

  let cursor = first
  let depth = 0

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (char === '"') {
      const token = readJsonStringToken(buffer, cursor)

      if (token === null) {
        return null
      }

      if (depth === 1 && token.value === 'features') {
        const colonIndex = skipJsonWhitespace(buffer, token.end)

        if (colonIndex >= buffer.length) {
          return null
        }

        if (buffer[colonIndex] === ':') {
          const valueIndex = skipJsonWhitespace(buffer, colonIndex + 1)

          if (valueIndex >= buffer.length) {
            return null
          }

          if (buffer[valueIndex] !== '[') {
            throw new Error(`Expected ${label} GeoJSON features to be an array.`)
          }

          return valueIndex + 1
        }
      }

      cursor = token.end
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1
    }

    cursor += 1
  }

  return null
}

function findJsonObjectEnd(buffer: string, start: number): number | null {
  let cursor = start
  let depth = 0

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (char === '"') {
      const end = findJsonStringEnd(buffer, cursor)

      if (end === null) {
        return null
      }

      cursor = end
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1

      if (depth === 0) {
        return cursor + 1
      }
    }

    cursor += 1
  }

  return null
}

function readJsonStringToken(buffer: string, start: number): JsonStringToken | null {
  const end = findJsonStringEnd(buffer, start)

  return end === null
    ? null
    : { value: JSON.parse(buffer.slice(start, end)) as string, end }
}

// The index after the closing quote of the string that opens at `start`, or
// null when the buffer ends first.
function findJsonStringEnd(buffer: string, start: number): number | null {
  let cursor = start + 1

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (char === '\\') {
      cursor += 2
      continue
    }

    if (char === '"') {
      return cursor + 1
    }

    cursor += 1
  }

  return null
}

function skipJsonWhitespace(buffer: string, start: number): number {
  let cursor = start

  while (cursor < buffer.length && isJsonWhitespace(buffer.charCodeAt(cursor))) {
    cursor += 1
  }

  return cursor
}

// Space, tab, line feed and carriage return.
function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
}
