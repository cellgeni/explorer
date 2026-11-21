// Reads the features of a GeoJSON FeatureCollection as its text arrives, one
// JSON.parse per feature, so a file of hundreds of megabytes is never held as
// one string or one object tree. A bare array of features, as QuPath exports
// objects, is read the same way.
//
// Each piece of text is scanned once, character by character, with the scan's
// state kept between pieces. An unfinished feature is kept as the pieces it
// spans and joined once it closes, so neither a large feature nor a long
// preamble before `features` is scanned or copied again with each piece.

export interface GeojsonFeatureStream {
  // Adds the next piece of text and reports the features it completes.
  push(text: string): void
  // Throws when the text ended before the features did.
  finish(): void
}

export type GeojsonFeatureHandler = (feature: unknown, featureIndex: number) => void

const QUOTE = 0x22
const BACKSLASH = 0x5c
const COLON = 0x3a
const COMMA = 0x2c
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const BYTE_ORDER_MARK = 0xfeff
// Escapes included, a key longer than this cannot be "features".
const MAX_KEY_TEXT = 64
// What changes the scan's state inside a feature, outside and inside strings.
const STRUCTURAL = /["{}[\]]/g
const STRING_SPECIAL = /["\\]/g

// `label` names the file in errors, as in "Expected <label> GeoJSON to be a
// FeatureCollection."
export function createGeojsonFeatureStream(
  onFeature: GeojsonFeatureHandler,
  options: { readonly label: string },
): GeojsonFeatureStream {
  const { label } = options
  // 'start' until the root value opens; 'find-features' inside a root object
  // until its `features` array opens; 'read-features' inside that array (or a
  // root array) until it closes.
  let mode: 'start' | 'find-features' | 'read-features' | 'done' = 'start'
  // In a string, and just after a backslash in one.
  let inString = false
  let escaped = false
  // The root object's nesting depth, while looking for `features`.
  let depth = 0
  // A string's text at depth 1, while it may still be "features".
  let key: string | null = null
  // After a depth-1 "features" string: its colon, then its array, are next.
  let featuresKey: 'colon' | 'array' | null = null
  // The feature being read: the pieces of its text so far, and its depth.
  let featureParts: string[] = []
  let featureDepth = 0
  let featureIndex = 0

  const notCollection = () =>
    new Error(`Expected ${label} GeoJSON to be a FeatureCollection.`)

  // Looks for the root object's `features` key from `start`, returning where
  // scanning stopped: the end of the text, or just after the array's `[`.
  const findFeatures = (text: string, start: number): number => {
    for (let index = start; index < text.length; index += 1) {
      const code = text.charCodeAt(index)

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (code === BACKSLASH) {
          escaped = true
        } else if (code === QUOTE) {
          inString = false

          if (key !== null && stringValue(key) === 'features') {
            featuresKey = 'colon'
          }

          key = null
          continue
        }

        if (key !== null) {
          key = key.length < MAX_KEY_TEXT ? key + text[index] : null
        }

        continue
      }

      if (featuresKey !== null && !isJsonWhitespace(code)) {
        if (featuresKey === 'array') {
          if (code !== OPEN_BRACKET) {
            throw new Error(`Expected ${label} GeoJSON features to be an array.`)
          }

          featuresKey = null
          mode = 'read-features'
          return index + 1
        }

        featuresKey = null

        // A colon makes it the key; anything else, a value named "features".
        if (code === COLON) {
          featuresKey = 'array'
          continue
        }
      }

      if (code === QUOTE) {
        inString = true
        key = depth === 1 ? '' : null
      } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        depth += 1
      } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
        depth -= 1

        // The root object closed without features, as a file of
        // newline-delimited features does after its first.
        if (depth === 0) {
          throw notCollection()
        }
      }
    }

    return text.length
  }

  // Reads features from `start`, returning where reading stopped. Inside a
  // feature it jumps from one structural character, or string end, to the
  // next, as most of a feature's text is coordinates.
  const readFeatures = (text: string, start: number): number => {
    let featureStart = featureDepth > 0 ? start : -1
    let index = start

    while (index < text.length) {
      if (featureDepth === 0) {
        const code = text.charCodeAt(index)

        if (isJsonWhitespace(code) || code === COMMA) {
          index += 1
          continue
        }

        if (code === CLOSE_BRACKET) {
          mode = 'done'
          return index + 1
        }

        if (code !== OPEN_BRACE) {
          throw new Error(
            `Expected ${label} GeoJSON feature ${featureIndex} to be an object.`,
          )
        }

        featureDepth = 1
        featureStart = index
        index += 1
        continue
      }

      if (escaped) {
        escaped = false
        index += 1
        continue
      }

      const pattern = inString ? STRING_SPECIAL : STRUCTURAL
      pattern.lastIndex = index
      const match = pattern.exec(text)

      if (match === null) {
        break
      }

      index = match.index
      const code = text.charCodeAt(index)
      index += 1

      if (inString) {
        if (code === BACKSLASH) {
          escaped = true
        } else {
          inString = false
        }
      } else if (code === QUOTE) {
        inString = true
      } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        featureDepth += 1
      } else {
        featureDepth -= 1

        if (featureDepth === 0) {
          featureParts.push(text.slice(featureStart, index))
          const featureText =
            featureParts.length === 1 ? featureParts[0] : featureParts.join('')
          featureParts = []
          featureStart = -1
          onFeature(JSON.parse(featureText ?? '') as unknown, featureIndex)
          featureIndex += 1
        }
      }
    }

    if (featureDepth > 0) {
      featureParts.push(text.slice(featureStart))
    }

    return text.length
  }

  const scan = (text: string): void => {
    let index = 0

    while (index < text.length && mode !== 'done') {
      if (mode === 'start') {
        const code = text.charCodeAt(index)
        index += 1

        if (code === BYTE_ORDER_MARK || isJsonWhitespace(code)) {
          continue
        }

        if (code === OPEN_BRACKET) {
          mode = 'read-features'
        } else if (code === OPEN_BRACE) {
          mode = 'find-features'
          depth = 1
        } else {
          throw notCollection()
        }
      } else if (mode === 'find-features') {
        index = findFeatures(text, index)
      } else {
        index = readFeatures(text, index)
      }
    }
  }

  return {
    push(text) {
      scan(text)
    },
    finish() {
      if (mode === 'start' || mode === 'find-features') {
        throw notCollection()
      }

      if (mode !== 'done') {
        throw new Error(`Unexpected end of ${label} GeoJSON feature stream.`)
      }
    },
  }
}

// A JSON string's value from the text between its quotes, or null when the
// text is not a valid string.
function stringValue(text: string): string | null {
  try {
    return JSON.parse(`"${text}"`) as string
  } catch {
    return null
  }
}

// Space, tab, line feed and carriage return.
function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
}
