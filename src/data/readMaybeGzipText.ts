export async function readMaybeGzipText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())

  if (!hasGzipHeader(bytes)) {
    return new TextDecoder().decode(bytes)
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  const body = new Response(bytes).body

  if (body === null) {
    return ''
  }

  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text()
}

function hasGzipHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b
}
