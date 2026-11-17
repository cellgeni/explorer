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
