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
