// Layer data given as packed typed arrays: `{ length, attributes }`.
export interface PackedLayerData {
  readonly length: number
  readonly attributes: Readonly<Record<string, object>>
}

// The data wrapper is rebuilt every render; only changed arrays count as new
// data, or deck.gl would regenerate picking colours on every frame.
export function samePackedLayerData(next: unknown, previous: unknown): boolean {
  const nextData = next as PackedLayerData | null
  const previousData = previous as PackedLayerData | null

  if (nextData === null || previousData === null) {
    return nextData === previousData
  }

  return (
    nextData.length === previousData.length &&
    Object.keys(nextData.attributes).every(
      (name) => nextData.attributes[name] === previousData.attributes[name],
    )
  )
}

// deck.gl re-uploads a packed attribute whenever its descriptor object changes,
// so each typed array keeps one descriptor.
const attributeDescriptors = new WeakMap<ArrayBufferView, object>()

export function attributeDescriptor(
  value: Float64Array | Float32Array | Uint8Array,
  size: number,
  normalized = false,
): object {
  const cached = attributeDescriptors.get(value)

  if (cached !== undefined) {
    return cached
  }

  const descriptor = { value, size, ...(normalized ? { normalized: true } : {}) }
  attributeDescriptors.set(value, descriptor)
  return descriptor
}
