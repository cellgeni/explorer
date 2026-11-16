// Sequential Huffman JPEG (ITU T.81 baseline SOF0 and extended sequential
// SOF1) at 8- or 12-bit precision. Browsers and geotiff's decoder only
// produce 8-bit samples; MERSCOPE `.vzg` pyramids store 12-bit tiles (SOF1),
// which this decoder returns as 16-bit samples. Progressive, lossless,
// hierarchical, and arithmetic-coded streams are refused. Components are
// returned as coded, without colour conversion. With `dcOnly`, each 8 × 8
// block decodes to one sample, its mean (the DC term), giving an image an
// eighth of the size for the cost of reading the coefficients.

export interface SequentialJpegImage {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly precision: 8 | 12
  // Samples interleaved by component, row by row: 8-bit precision gives a
  // Uint8Array, 12-bit a Uint16Array.
  readonly data: Uint8Array | Uint16Array
}

export class JpegDecodeError extends Error {
  constructor(message: string) {
    super(`JPEG: ${message}`)
    this.name = 'JpegDecodeError'
  }
}

interface HuffmanTable {
  // Per code length 1-16: the largest code of that length (-1 for none), and
  // where its values start.
  readonly maxcode: Int32Array
  readonly valptr: Int32Array
  readonly mincode: Int32Array
  readonly values: Uint8Array
}

interface FrameComponent {
  readonly id: number
  readonly h: number
  readonly v: number
  readonly quantTable: number
  // The component's coded size in blocks, padded to whole MCUs.
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  // Decoded samples, blocksPerLine * 8 wide (blocksPerLine for dcOnly).
  readonly samples: Float32Array
  dcPredictor: number
  dcTable: number
  acTable: number
}

interface Frame {
  readonly precision: 8 | 12
  readonly width: number
  readonly height: number
  readonly maxH: number
  readonly maxV: number
  readonly mcusPerLine: number
  readonly mcusPerColumn: number
  readonly components: readonly FrameComponent[]
}

export interface SequentialJpegOptions {
  readonly dcOnly?: boolean
}

interface DecoderState {
  readonly dcOnly: boolean
  readonly quantTables: (Int32Array | undefined)[]
  readonly dcTables: (HuffmanTable | undefined)[]
  readonly acTables: (HuffmanTable | undefined)[]
  restartInterval: number
  frame: Frame | null
}

const SOI = 0xd8
const EOI = 0xd9
const SOF0 = 0xc0
const SOF1 = 0xc1
const DHT = 0xc4
const DQT = 0xdb
const DRI = 0xdd
const SOS = 0xda
const RST0 = 0xd0
const RST7 = 0xd7
const TEM = 0x01

// Natural (row-major) index of the k-th coefficient in zigzag order.
const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37,
  44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

// IDCT basis: COSINES[x * 8 + u] = C(u) / 2 * cos((2x + 1) u π / 16).
const COSINES = (() => {
  const table = new Float32Array(64)

  for (let x = 0; x < 8; x += 1) {
    for (let u = 0; u < 8; u += 1) {
      const scale = u === 0 ? Math.SQRT1_2 / 2 : 0.5
      table[x * 8 + u] = scale * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
    }
  }

  return table
})()

// Decodes one stream. `tables` is a TIFF JPEGTables stream (SOI, DQT and
// DHT segments, EOI) that the stream may rely on.
export function decodeSequentialJpeg(
  bytes: Uint8Array,
  tables?: Uint8Array,
  options: SequentialJpegOptions = {},
): SequentialJpegImage {
  const state: DecoderState = {
    dcOnly: options.dcOnly === true,
    quantTables: [],
    dcTables: [],
    acTables: [],
    restartInterval: 0,
    frame: null,
  }

  if (tables !== undefined && tables.length > 0) {
    readSegments(tables, state)
  }

  readSegments(bytes, state)

  if (state.frame === null) {
    throw new JpegDecodeError('the stream has no frame.')
  }

  return outputImage(state.frame, state.dcOnly)
}

// The precision of a stream's frame, or undefined when it has none before
// its first scan. Reads marker segments only.
export function jpegPrecision(bytes: Uint8Array): number | undefined {
  let position = 2

  while (position + 4 <= bytes.length) {
    if (bytes[position] !== 0xff) {
      return undefined
    }

    const marker = bytes[position + 1] ?? 0

    if (marker === 0xff) {
      position += 1
      continue
    }

    if (marker === SOS || marker === EOI) {
      return undefined
    }

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== DHT &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return bytes[position + 4]
    }

    position += 2 + readUint16(bytes, position + 2)
  }

  return undefined
}

function readSegments(data: Uint8Array, state: DecoderState): void {
  if (data[0] !== 0xff || data[1] !== SOI) {
    throw new JpegDecodeError('missing start of image.')
  }

  let position = 2

  while (position < data.length) {
    if (data[position] !== 0xff) {
      throw new JpegDecodeError(`expected a marker at byte ${position}.`)
    }

    const marker = data[position + 1] ?? 0
    position += 2

    // Fill bytes before a marker.
    if (marker === 0xff) {
      position -= 1
      continue
    }

    if (marker === EOI) {
      return
    }

    if (marker === TEM || (marker >= RST0 && marker <= RST7)) {
      continue
    }

    const length = readUint16(data, position)
    const segment = data.subarray(position + 2, position + length)

    if (marker === SOF0 || marker === SOF1) {
      state.frame = readFrame(segment, state.dcOnly)
    } else if (
      marker >= 0xc2 &&
      marker <= 0xcf &&
      marker !== DHT &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      throw new JpegDecodeError(
        `frame type 0x${marker.toString(16)} is not supported; only sequential Huffman JPEG is.`,
      )
    } else if (marker === DHT) {
      readHuffmanTables(segment, state)
    } else if (marker === DQT) {
      readQuantTables(segment, state)
    } else if (marker === DRI) {
      state.restartInterval = readUint16(segment, 0)
    } else if (marker === SOS) {
      position = decodeScan(data, position + length, segment, state)
      continue
    }

    position += length
  }
}

function readFrame(segment: Uint8Array, dcOnly: boolean): Frame {
  const precision = segment[0]

  if (precision !== 8 && precision !== 12) {
    throw new JpegDecodeError(`${precision}-bit precision is not supported.`)
  }

  const height = readUint16(segment, 1)
  const width = readUint16(segment, 3)
  const count = segment[5] ?? 0

  if (width === 0 || height === 0 || count === 0) {
    throw new JpegDecodeError(
      'the frame has no size or components (DNL is not supported).',
    )
  }

  const specs = Array.from({ length: count }, (_, index) => ({
    id: segment[6 + index * 3] ?? 0,
    h: (segment[7 + index * 3] ?? 0x11) >> 4,
    v: (segment[7 + index * 3] ?? 0x11) & 15,
    quantTable: segment[8 + index * 3] ?? 0,
  }))
  const maxH = Math.max(...specs.map((spec) => spec.h))
  const maxV = Math.max(...specs.map((spec) => spec.v))
  const mcusPerLine = Math.ceil(width / (8 * maxH))
  const mcusPerColumn = Math.ceil(height / (8 * maxV))

  return {
    precision,
    width,
    height,
    maxH,
    maxV,
    mcusPerLine,
    mcusPerColumn,
    components: specs.map((spec) => {
      const blocksPerLine = mcusPerLine * spec.h
      const blocksPerColumn = mcusPerColumn * spec.v

      return {
        ...spec,
        blocksPerLine,
        blocksPerColumn,
        samples: new Float32Array(
          dcOnly
            ? blocksPerLine * blocksPerColumn
            : blocksPerLine * 8 * blocksPerColumn * 8,
        ),
        dcPredictor: 0,
        dcTable: 0,
        acTable: 0,
      }
    }),
  }
}

function readHuffmanTables(segment: Uint8Array, state: DecoderState): void {
  let position = 0

  while (position < segment.length) {
    const info = segment[position] ?? 0
    const counts = segment.subarray(position + 1, position + 17)
    let total = 0

    for (const count of counts) {
      total += count
    }

    const values = segment.slice(position + 17, position + 17 + total)
    const table = huffmanTable(counts, values)

    if (info >> 4 === 0) {
      state.dcTables[info & 15] = table
    } else {
      state.acTables[info & 15] = table
    }

    position += 17 + total
  }
}

// Canonical Huffman codes (T.81 Annex C), decoded with the MAXCODE / VALPTR
// / MINCODE procedure of F.2.2.3.
function huffmanTable(counts: Uint8Array, values: Uint8Array): HuffmanTable {
  const maxcode = new Int32Array(18).fill(-1)
  const valptr = new Int32Array(17)
  const mincode = new Int32Array(17)
  let code = 0
  let index = 0

  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0

    if (count > 0) {
      valptr[length] = index
      mincode[length] = code
      code += count
      index += count
      maxcode[length] = code - 1
    }

    code <<= 1
  }

  // Ends the search for a code longer than 16 bits.
  maxcode[17] = 0x7fffffff
  return { maxcode, valptr, mincode, values }
}

function readQuantTables(segment: Uint8Array, state: DecoderState): void {
  let position = 0

  while (position < segment.length) {
    const info = segment[position] ?? 0
    const sixteenBit = info >> 4 === 1
    const table = new Int32Array(64)

    for (let k = 0; k < 64; k += 1) {
      table[k] = sixteenBit
        ? readUint16(segment, position + 1 + k * 2)
        : (segment[position + 1 + k] ?? 0)
    }

    state.quantTables[info & 15] = table
    position += 1 + (sixteenBit ? 128 : 64)
  }
}

// Decodes the entropy-coded data after a scan header and returns the
// position of the marker that ends it.
function decodeScan(
  data: Uint8Array,
  start: number,
  header: Uint8Array,
  state: DecoderState,
): number {
  const frame = state.frame

  if (frame === null) {
    throw new JpegDecodeError('a scan comes before the frame.')
  }

  const count = header[0] ?? 0
  const components: FrameComponent[] = []

  for (let index = 0; index < count; index += 1) {
    const id = header[1 + index * 2]
    const tables = header[2 + index * 2] ?? 0
    const component = frame.components.find((candidate) => candidate.id === id)

    if (component === undefined) {
      throw new JpegDecodeError(`the scan names an unknown component ${id}.`)
    }

    component.dcTable = tables >> 4
    component.acTable = tables & 15
    component.dcPredictor = 0
    components.push(component)
  }

  const reader = new BitReader(data, start)
  const coefficients = new Float32Array(64)
  const block = new Float32Array(64)
  const single = components.length === 1
  const only = components[0]

  // A scan of one component codes its blocks one by one over the
  // component's own size, not the padded MCU grid.
  const mcuCount =
    single && only !== undefined
      ? Math.ceil(Math.ceil((frame.width * only.h) / frame.maxH) / 8) *
        Math.ceil(Math.ceil((frame.height * only.v) / frame.maxV) / 8)
      : frame.mcusPerLine * frame.mcusPerColumn
  const singleBlocksPerLine =
    single && only !== undefined
      ? Math.ceil(Math.ceil((frame.width * only.h) / frame.maxH) / 8)
      : 0

  for (let mcu = 0; mcu < mcuCount; mcu += 1) {
    if (state.restartInterval > 0 && mcu > 0 && mcu % state.restartInterval === 0) {
      reader.restart()

      for (const component of components) {
        component.dcPredictor = 0
      }
    }

    if (single && only !== undefined) {
      const row = Math.floor(mcu / singleBlocksPerLine)
      const col = mcu % singleBlocksPerLine
      decodeBlock(reader, state, frame, only, coefficients, block, row, col)
      continue
    }

    const mcuRow = Math.floor(mcu / frame.mcusPerLine)
    const mcuCol = mcu % frame.mcusPerLine

    for (const component of components) {
      for (let v = 0; v < component.v; v += 1) {
        for (let h = 0; h < component.h; h += 1) {
          decodeBlock(
            reader,
            state,
            frame,
            component,
            coefficients,
            block,
            mcuRow * component.v + v,
            mcuCol * component.h + h,
          )
        }
      }
    }
  }

  return reader.markerPosition()
}

function decodeBlock(
  reader: BitReader,
  state: DecoderState,
  frame: Frame,
  component: FrameComponent,
  coefficients: Float32Array,
  block: Float32Array,
  row: number,
  col: number,
): void {
  const quant = state.quantTables[component.quantTable]
  const dc = state.dcTables[component.dcTable]
  const ac = state.acTables[component.acTable]

  if (quant === undefined || dc === undefined || ac === undefined) {
    throw new JpegDecodeError('a scan uses a table the stream does not define.')
  }

  coefficients.fill(0)
  const size = reader.decode(dc)
  component.dcPredictor += size === 0 ? 0 : extend(reader.receive(size), size)
  coefficients[0] = component.dcPredictor * (quant[0] ?? 0)
  let hasAc = false

  for (let k = 1; k < 64; ) {
    const symbol = reader.decode(ac)
    const run = symbol >> 4
    const bits = symbol & 15

    if (bits === 0) {
      if (run !== 15) {
        break
      }

      k += 16
      continue
    }

    k += run

    if (k > 63) {
      break
    }

    coefficients[ZIGZAG[k] ?? 0] = extend(reader.receive(bits), bits) * (quant[k] ?? 0)
    hasAc = true
    k += 1
  }

  if (row >= component.blocksPerColumn || col >= component.blocksPerLine) {
    return
  }

  const shift = frame.precision === 12 ? 2048 : 128

  if (state.dcOnly) {
    component.samples[row * component.blocksPerLine + col] =
      (coefficients[0] ?? 0) / 8 + shift
    return
  }

  const stride = component.blocksPerLine * 8
  const origin = row * 8 * stride + col * 8

  if (!hasAc) {
    // Only the DC term: the block is flat.
    const value = (coefficients[0] ?? 0) / 8 + shift

    for (let y = 0; y < 8; y += 1) {
      component.samples.fill(value, origin + y * stride, origin + y * stride + 8)
    }

    return
  }

  inverseDct(coefficients, block)

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      component.samples[origin + y * stride + x] = (block[y * 8 + x] ?? 0) + shift
    }
  }
}

// Separable 8 × 8 inverse DCT in floating point.
function inverseDct(input: Float32Array, output: Float32Array): void {
  const rows = new Float32Array(64)

  for (let v = 0; v < 8; v += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0

      for (let u = 0; u < 8; u += 1) {
        sum += (COSINES[x * 8 + u] ?? 0) * (input[v * 8 + u] ?? 0)
      }

      rows[v * 8 + x] = sum
    }
  }

  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      let sum = 0

      for (let v = 0; v < 8; v += 1) {
        sum += (COSINES[y * 8 + v] ?? 0) * (rows[v * 8 + x] ?? 0)
      }

      output[y * 8 + x] = sum
    }
  }
}

function outputImage(frame: Frame, dcOnly: boolean): SequentialJpegImage {
  const { precision } = frame
  const width = dcOnly ? Math.ceil(frame.width / 8) : frame.width
  const height = dcOnly ? Math.ceil(frame.height / 8) : frame.height
  const count = frame.components.length
  const max = precision === 12 ? 4095 : 255
  const data =
    precision === 12
      ? new Uint16Array(width * height * count)
      : new Uint8Array(width * height * count)

  frame.components.forEach((component, index) => {
    const stride = component.blocksPerLine * (dcOnly ? 1 : 8)
    const scaleX = component.h / frame.maxH
    const scaleY = component.v / frame.maxV

    for (let y = 0; y < height; y += 1) {
      const sourceRow = Math.floor(y * scaleY) * stride

      for (let x = 0; x < width; x += 1) {
        const value = Math.round(
          component.samples[sourceRow + Math.floor(x * scaleX)] ?? 0,
        )
        data[(y * width + x) * count + index] = value < 0 ? 0 : value > max ? max : value
      }
    }
  })

  return { width, height, components: count, precision, data }
}

function extend(value: number, bits: number): number {
  return value < 1 << (bits - 1) ? value - (1 << bits) + 1 : value
}

function readUint16(data: Uint8Array, position: number): number {
  return ((data[position] ?? 0) << 8) | (data[position + 1] ?? 0)
}

// Reads entropy-coded bits, removing stuffed zero bytes. At a marker it
// supplies zero bits and stays put, so the scan ends there.
class BitReader {
  private bits = 0
  private count = 0
  private markerAt = -1

  constructor(
    private readonly data: Uint8Array,
    private position: number,
  ) {}

  decode(table: HuffmanTable): number {
    let code = this.bit()
    let length = 1

    while (code > (table.maxcode[length] ?? -1)) {
      code = (code << 1) | this.bit()
      length += 1

      if (length > 16) {
        throw new JpegDecodeError('a Huffman code is longer than 16 bits.')
      }
    }

    return (
      table.values[(table.valptr[length] ?? 0) + code - (table.mincode[length] ?? 0)] ?? 0
    )
  }

  receive(length: number): number {
    let value = 0

    for (let index = 0; index < length; index += 1) {
      value = (value << 1) | this.bit()
    }

    return value
  }

  // Skips to the byte after the next RSTn marker.
  restart(): void {
    this.bits = 0
    this.count = 0
    let position = this.markerAt >= 0 ? this.markerAt : this.position

    while (position + 1 < this.data.length) {
      if (this.data[position] === 0xff) {
        const marker = this.data[position + 1] ?? 0

        if (marker >= RST0 && marker <= RST7) {
          position += 2
          break
        }

        if (marker !== 0 && marker !== 0xff) {
          break
        }
      }

      position += 1
    }

    this.position = position
    this.markerAt = -1
  }

  // Where the scan's data ends: the marker that stopped it, or the next one.
  markerPosition(): number {
    let position = this.markerAt >= 0 ? this.markerAt : this.position

    while (position + 1 < this.data.length) {
      if (this.data[position] === 0xff) {
        const marker = this.data[position + 1] ?? 0

        if (marker !== 0 && marker !== 0xff && !(marker >= RST0 && marker <= RST7)) {
          return position
        }
      }

      position += 1
    }

    return this.data.length
  }

  private bit(): number {
    if (this.count === 0) {
      this.fill()
    }

    this.count -= 1
    return (this.bits >> this.count) & 1
  }

  private fill(): void {
    this.count = 8

    if (this.markerAt >= 0 || this.position >= this.data.length) {
      this.bits = 0
      return
    }

    const byte = this.data[this.position] ?? 0

    if (byte === 0xff) {
      const next = this.data[this.position + 1] ?? 0

      if (next !== 0) {
        this.markerAt = this.position
        this.bits = 0
        return
      }

      this.position += 2
      this.bits = 0xff
      return
    }

    this.position += 1
    this.bits = byte
  }
}
