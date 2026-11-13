export function transferablesOf(value: unknown): Transferable[] {
  if (!ArrayBuffer.isView(value)) {
    return []
  }

  const buffer = value.buffer

  // Only a buffer the view covers whole; a view into a larger buffer, such as
  // a wasm heap, is copied by structured clone instead.
  return buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === buffer.byteLength
    ? [buffer]
    : []
}
