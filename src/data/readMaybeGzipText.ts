export async function readMaybeGzipText(response: Response): Promise<string> {
  return new TextDecoder().decode(await readMaybeGzipBytes(response))
}

// The response body, inflated when its bytes start with the gzip magic
// number, whatever the URL's suffix.
export async function readMaybeGzipBytes(response: Response): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer())

  if (!hasGzipHeader(bytes)) {
    return bytes
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  const body = new Response(bytes).body

  if (body === null) {
    return new Uint8Array(0)
  }

  return new Uint8Array(
    await new Response(body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),
  )
}

export interface InflatedSize {
  readonly byteLength: number
  // True when the gzip trailer gave the whole size; false when inflating
  // stopped at `byteLength`, so the file is larger.
  readonly exact: boolean
}

// `bytes`, inflated when they start with the gzip magic number. A file whose
// trailer gives an inflated size over `maxBytes` is refused unread, and
// inflating stops once the output passes it (the trailer holds the size
// modulo 4 GiB, and only the last member's), so a file far beyond the limit
// is never held whole.
export async function inflateMaybeGzipBytes(
  bytes: Uint8Array<ArrayBuffer>,
  maxBytes: number,
  tooLarge: (size: InflatedSize) => Error,
): Promise<Uint8Array> {
  if (!hasGzipHeader(bytes)) {
    return bytes
  }

  const declared = gzipTrailerSize(bytes)

  if (declared !== undefined && declared > maxBytes) {
    throw tooLarge({ byteLength: declared, exact: true })
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  const body = new Response(bytes).body

  if (body === null) {
    return new Uint8Array(0)
  }

  const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge({ byteLength: total, exact: false })
    }

    chunks.push(value)
  }

  const inflated = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    inflated.set(chunk, offset)
    offset += chunk.byteLength
  }

  return inflated
}

// ISIZE, the gzip trailer's inflated size of the last member, modulo 4 GiB.
function gzipTrailerSize(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 18) {
    return undefined
  }

  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    bytes.byteLength - 4,
    true,
  )
}

function hasGzipHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b
}

// Calls `onLine` with each line of the body, inflated as readMaybeGzipBytes
// does, as it arrives: neither the file nor its text is held whole. Lines end
// at `\n`, with a trailing `\r` dropped. Throwing from `onLine` stops the
// read and cancels the download.
export async function forEachMaybeGzipLine(
  response: Response,
  onLine: (line: string, lineIndex: number) => void,
): Promise<void> {
  if (response.body === null) {
    return
  }

  const reader = (await maybeInflatedBody(response.body)).getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let lineIndex = 0
  const emit = (text: string, final: boolean) => {
    let start = 0
    let end = text.indexOf('\n')

    while (end !== -1) {
      onLine(lineWithoutCarriageReturn(text.slice(start, end)), lineIndex)
      lineIndex += 1
      start = end + 1
      end = text.indexOf('\n', start)
    }

    const rest = text.slice(start)

    if (final && rest.length > 0) {
      onLine(lineWithoutCarriageReturn(rest), lineIndex)
      lineIndex += 1
    }

    return rest
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        emit(pending + decoder.decode(), true)
        return
      }

      pending = emit(pending + decoder.decode(value, { stream: true }), false)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  }
}

// Calls `onText` with the body's text as it arrives, inflated as
// readMaybeGzipBytes does. Throwing from `onText` stops the read and cancels
// the download.
export async function forEachMaybeGzipText(
  response: Response,
  onText: (text: string) => void,
): Promise<void> {
  if (response.body === null) {
    return
  }

  const reader = (await maybeInflatedBody(response.body)).getReader()
  const decoder = new TextDecoder()

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        onText(decoder.decode())
        return
      }

      onText(decoder.decode(value, { stream: true }))
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  }
}

function lineWithoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

// The body, piped through gzip decompression when its first two bytes are
// the gzip magic number.
async function maybeInflatedBody(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader()
  const head: Uint8Array<ArrayBuffer>[] = []
  let headLength = 0
  let done = false

  while (headLength < 2 && !done) {
    const next = await reader.read()

    if (next.done) {
      done = true
    } else {
      head.push(next.value)
      headLength += next.value.byteLength
    }
  }

  const first = head[0]
  const second = first !== undefined && first.byteLength > 1 ? first[1] : head[1]?.[0]
  const isGzip = first?.[0] === 0x1f && second === 0x8b
  const replayed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of head) {
        controller.enqueue(chunk)
      }

      if (done) {
        controller.close()
      }
    },
    async pull(controller) {
      const next = await reader.read()

      if (next.done) {
        controller.close()
      } else {
        controller.enqueue(next.value)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  if (!isGzip) {
    return replayed
  }

  if (typeof DecompressionStream !== 'function') {
    await reader.cancel().catch(() => undefined)
    throw new Error('This browser does not support gzip decompression.')
  }

  return replayed.pipeThrough(new DecompressionStream('gzip'))
}
