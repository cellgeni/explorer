export async function readMaybeGzipText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())

  if (!hasGzipHeader(bytes)) {
    return new TextDecoder().decode(bytes)
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function hasGzipHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b
}
