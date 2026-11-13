// numcodecs' VLenUTF8 layout: item count, then length-prefixed UTF-8 items.
export function vlenUtf8Bytes(items: readonly string[]): Uint8Array {
  const encoded = items.map((item) => new TextEncoder().encode(item))
  const bytes = new Uint8Array(
    4 + encoded.reduce((total, item) => total + 4 + item.length, 0),
  )
  const view = new DataView(bytes.buffer)
  view.setUint32(0, items.length, true)
  let position = 4

  for (const item of encoded) {
    view.setUint32(position, item.length, true)
    bytes.set(item, position + 4)
    position += 4 + item.length
  }

  return bytes
}

// A copy in a buffer of its own; Node's Buffer.slice shares a pooled buffer.
export function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}
