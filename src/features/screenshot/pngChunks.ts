// PNG chunks a screenshot adds to what the canvas writes (plan 27-D11): its
// dpi in `pHYs`, and where it came from in text chunks with the PNG
// specification's keywords.

export interface PngChunk {
  // Four ASCII letters, such as 'tEXt'.
  readonly type: string
  readonly data: Uint8Array
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const METRES_PER_INCH = 0.0254

// Chunks go after IHDR, which the specification puts first; pHYs must come
// before the image data, and text chunks may come anywhere.
export function insertPngChunks(
  png: Uint8Array,
  chunks: readonly PngChunk[],
): Uint8Array {
  if (!hasPngSignature(png)) throw new Error('Not a PNG file.')

  const ihdrLength = readUint32(png, 8)
  const ihdrEnd = 8 + 12 + ihdrLength
  if (chunkType(png, 8) !== 'IHDR' || ihdrEnd > png.length) {
    throw new Error('The PNG file has no header chunk.')
  }

  const encoded = chunks.map(encodeChunk)
  const out = new Uint8Array(
    png.length + encoded.reduce((total, chunk) => total + chunk.length, 0),
  )
  out.set(png.subarray(0, ihdrEnd), 0)
  let offset = ihdrEnd
  for (const chunk of encoded) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  out.set(png.subarray(ihdrEnd), offset)
  return out
}

// Pixels per metre on both axes, which is how PNG records dpi.
export function pngPhysChunk(dpi: number): PngChunk {
  const perMetre = Math.round(dpi / METRES_PER_INCH)
  const data = new Uint8Array(9)
  writeUint32(data, 0, perMetre)
  writeUint32(data, 4, perMetre)
  data[8] = 1
  return { type: 'pHYs', data }
}

// A Latin-1 `tEXt` chunk, or an `iTXt` (UTF-8) one when the text has other
// characters.
export function pngTextChunk(keyword: string, text: string): PngChunk {
  const latin1 = isLatin1(text)
  const key = latin1Bytes(keyword)

  if (latin1) {
    return { type: 'tEXt', data: concat([key, [0], latin1Bytes(text)]) }
  }

  // Keyword, null, no compression (flag and method), empty language tag and
  // translated keyword, each ended by a null, then the text.
  return {
    type: 'iTXt',
    data: concat([key, [0, 0, 0, 0, 0], new TextEncoder().encode(text)]),
  }
}

export interface ReadPngChunk {
  readonly type: string
  readonly data: Uint8Array
}

// Every chunk of a PNG, in order; for tests and checks.
export function readPngChunks(png: Uint8Array): readonly ReadPngChunk[] {
  if (!hasPngSignature(png)) throw new Error('Not a PNG file.')

  const chunks: ReadPngChunk[] = []
  let offset = 8

  while (offset + 12 <= png.length) {
    const length = readUint32(png, offset)
    const type = chunkType(png, offset)
    const data = png.subarray(offset + 8, offset + 8 + length)
    const crc = readUint32(png, offset + 8 + length)
    if (crc !== crc32(png.subarray(offset + 4, offset + 8 + length))) {
      throw new Error(`The PNG's ${type} chunk fails its CRC.`)
    }
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }

  return chunks
}

// A text chunk's keyword and text, for tests and checks.
export function pngTextEntries(png: Uint8Array): Readonly<Record<string, string>> {
  const entries: Record<string, string> = {}

  for (const chunk of readPngChunks(png)) {
    const nul = chunk.data.indexOf(0)
    if (nul < 0) continue
    const keyword = String.fromCharCode(...chunk.data.subarray(0, nul))

    if (chunk.type === 'tEXt') {
      entries[keyword] = String.fromCharCode(...chunk.data.subarray(nul + 1))
    } else if (chunk.type === 'iTXt') {
      // Skip the compression flag and method, then the language tag and
      // translated keyword, each ended by a null.
      let offset = nul + 3
      for (let ended = 0; ended < 2; ended += 1) {
        offset = chunk.data.indexOf(0, offset) + 1
      }
      entries[keyword] = new TextDecoder().decode(chunk.data.subarray(offset))
    }
  }

  return entries
}

function encodeChunk(chunk: PngChunk): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(chunk.type))
    throw new Error(`Bad PNG chunk type ${chunk.type}`)

  const out = new Uint8Array(12 + chunk.data.length)
  writeUint32(out, 0, chunk.data.length)
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = chunk.type.charCodeAt(index)
  }
  out.set(chunk.data, 8)
  writeUint32(out, 8 + chunk.data.length, crc32(out.subarray(4, 8 + chunk.data.length)))
  return out
}

let crcTable: Uint32Array | null = null

// CRC-32 as PNG computes it, over a chunk's type and data.
export function crc32(bytes: Uint8Array): number {
  crcTable ??= makeCrcTable()
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }

  return table
}

function hasPngSignature(png: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => png[index] === byte)
}

function chunkType(png: Uint8Array, offset: number): string {
  return String.fromCharCode(...png.subarray(offset + 4, offset + 8))
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value)
}

function isLatin1(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0xff) return false
  }
  return true
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff
  }
  return bytes
}

function concat(parts: readonly (Uint8Array | readonly number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
