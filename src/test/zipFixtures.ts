import { crc32, deflateRawSync } from 'node:zlib'

export interface ZipFixtureFile {
  readonly name: string
  readonly data: Uint8Array
  // Deflate the entry instead of storing it.
  readonly deflate?: boolean
  // The local header's extra field, in place of the default 4 bytes, as
  // writers that pad entries for alignment write.
  readonly localExtra?: Uint8Array
}

export interface ByteRangeRequest {
  readonly method: string
  readonly url: string
  readonly range: string | null
}

// Local headers carry an extra field the central directory lacks, as zip64
// writers' do, so a reader must take the data offset from the local header.
const LOCAL_EXTRA_FIELD = Uint8Array.of(0xfe, 0xca, 0x00, 0x00)

export interface ZipArchiveOptions {
  // Writes sizes and offsets in ZIP64 extra fields and ZIP64 end records,
  // with the 32-bit fields saturated, as writers of archives over 4 GB do.
  readonly zip64?: boolean
  // The archive comment after the end of central directory record.
  readonly comment?: Uint8Array
}

export function zipArchive(
  files: readonly ZipFixtureFile[],
  options: ZipArchiveOptions = {},
): Uint8Array {
  const zip64 = options.zip64 === true
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const method = file.deflate === true ? 8 : 0
    const body =
      file.deflate === true ? new Uint8Array(deflateRawSync(file.data)) : file.data
    const crc = crc32(file.data)
    const localExtra = file.localExtra ?? LOCAL_EXTRA_FIELD
    const local = new Uint8Array(30 + nameBytes.length + localExtra.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, body.length, true)
    localView.setUint32(22, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, localExtra.length, true)
    local.set(nameBytes, 30)
    local.set(localExtra, 30 + nameBytes.length)

    const central = new Uint8Array(46 + nameBytes.length + (zip64 ? 28 : 0))
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, zip64 ? 0xffffffff : body.length, true)
    centralView.setUint32(24, zip64 ? 0xffffffff : file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, zip64 ? 0xffffffff : offset, true)
    central.set(nameBytes, 46)

    if (zip64) {
      const extra = 46 + nameBytes.length
      centralView.setUint16(30, 28, true)
      centralView.setUint16(extra, 0x0001, true)
      centralView.setUint16(extra + 2, 24, true)
      centralView.setBigUint64(extra + 4, BigInt(file.data.length), true)
      centralView.setBigUint64(extra + 12, BigInt(body.length), true)
      centralView.setBigUint64(extra + 20, BigInt(offset), true)
    }

    localParts.push(local, body)
    centralParts.push(central)
    offset += local.length + body.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const comment = options.comment ?? new Uint8Array(0)
  const end = new Uint8Array(22 + comment.length)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, zip64 ? 0xffff : files.length, true)
  endView.setUint16(10, zip64 ? 0xffff : files.length, true)
  endView.setUint32(12, zip64 ? 0xffffffff : centralSize, true)
  endView.setUint32(16, zip64 ? 0xffffffff : offset, true)
  endView.setUint16(20, comment.length, true)
  end.set(comment, 22)

  if (!zip64) {
    return concat([...localParts, ...centralParts, end])
  }

  const record = new Uint8Array(56)
  const recordView = new DataView(record.buffer)
  recordView.setUint32(0, 0x06064b50, true)
  recordView.setBigUint64(4, 44n, true)
  recordView.setBigUint64(24, BigInt(files.length), true)
  recordView.setBigUint64(32, BigInt(files.length), true)
  recordView.setBigUint64(40, BigInt(centralSize), true)
  recordView.setBigUint64(48, BigInt(offset), true)
  const locator = new Uint8Array(20)
  const locatorView = new DataView(locator.buffer)
  locatorView.setUint32(0, 0x07064b50, true)
  locatorView.setBigUint64(8, BigInt(offset + centralSize), true)
  locatorView.setUint32(16, 1, true)

  return concat([...localParts, ...centralParts, record, locator, end])
}

// Serves files by absolute URL with HEAD and single-range GET support; other
// URLs answer 404.
export function byteRangeFetcher(
  files: ReadonlyMap<string, Uint8Array>,
  requests: ByteRangeRequest[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const range = request.headers.get('Range')
    requests.push({ method: request.method, url: request.url, range })
    const bytes = files.get(request.url)

    if (bytes === undefined) {
      return new Response(null, { status: 404 })
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    const match = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range)

    if (match === null) {
      return new Response(Uint8Array.from(bytes), { status: 200 })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), { status: 206 })
  }) as typeof fetch
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}
