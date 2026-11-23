// `annotationUrl=` and Import URL read the whole file and parse it on the main
// thread, so a link to a large file could stall or crash the tab. Parsing runs
// at about 40 MB/s (2 million `cell_id,label` rows, 95 MB, in 2.5 s), so the
// limit keeps a few million rows and refuses larger files before they are read.
export const ANNOTATION_URL_MAX_BYTES = 100 * 1024 * 1024

export class AnnotationUrlTooLargeError extends Error {
  readonly sourceName: string
  // From Content-Length; null when the file was cut off while being read.
  readonly byteLength: number | null

  constructor(sourceName: string, byteLength: number | null, maxBytes: number) {
    const limit = `${formatMebibytes(maxBytes)} limit for annotation URLs`
    super(
      byteLength === null
        ? `${sourceName} is larger than the ${limit}.`
        : `${sourceName} is ${sizeAboveLimit(byteLength, maxBytes)}, above the ${limit}.`,
    )
    this.name = 'AnnotationUrlTooLargeError'
    this.sourceName = sourceName
    this.byteLength = byteLength
  }
}

// The response's text, refused before it is read when Content-Length is over
// the limit, or as soon as the bytes read pass it (for hosts that send none,
// and compressed responses, whose Content-Length is the compressed size).
export async function readAnnotationUrlText(
  response: Response,
  sourceName: string,
  maxBytes = ANNOTATION_URL_MAX_BYTES,
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  const declared = contentLength === null ? Number.NaN : Number(contentLength)

  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new AnnotationUrlTooLargeError(sourceName, declared, maxBytes)
  }

  if (response.body === null) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      parts.push(decoder.decode())
      return parts.join('')
    }

    received += value.byteLength

    if (received > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // The size error is more useful than a stream cleanup failure.
      }

      throw new AnnotationUrlTooLargeError(sourceName, null, maxBytes)
    }

    parts.push(decoder.decode(value, { stream: true }))
  }
}

const MEBIBYTE = 1024 * 1024

export function formatMebibytes(byteLength: number): string {
  const mebibytes = byteLength / MEBIBYTE
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`
}

// With enough decimals to read as more than the limit: 104,900,000 bytes is
// 100.04 MiB, not "100.0".
function sizeAboveLimit(byteLength: number, maxBytes: number): string {
  const mebibytes = byteLength / MEBIBYTE

  for (let digits = 1; digits <= 4; digits += 1) {
    const text = mebibytes.toFixed(digits)

    if (Number(text) > maxBytes / MEBIBYTE) {
      return `${text} MiB`
    }
  }

  return `${byteLength.toLocaleString()} bytes`
}
