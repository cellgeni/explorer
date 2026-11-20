// Per-cell sums over one image tile, for Cell Query's image channel columns
// (plan 26-D4). A cell is a disc, round in micrometres, so an ellipse in the
// pixels of an image whose pixels are not square. A pixel counts for a cell
// when the pixel's centre is inside its disc; a pixel inside several discs
// counts for the cell whose centre is nearest relative to its radius, so
// neighbours do not share pixels. Workers and the main thread share this.

// The cells whose discs touch a tile, in the tile's pixels: pixel i's centre
// is at i + 0.5. The radius is in pixel widths. On ties the cell listed
// first takes the pixel.
export interface TileCellDiscs {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly radius: Float32Array
}

export interface TileCellMeasureOptions {
  // The tile's visible size; decoded edge tiles may be padded beyond it.
  readonly width: number
  readonly height: number
  // Pixels at or above it count as above.
  readonly threshold: number
  // A pixel's height over its width (1 for square pixels): a disc of radius
  // r reaches r pixels across and r / yScale pixels down.
  readonly yScale: number
}

// Per cell, in the order of the discs.
export interface TileCellSums {
  readonly sum: Float64Array
  readonly count: Uint32Array
  readonly above: Uint32Array
}

// Kept between calls, as a worker measures tile after tile.
let nearest = new Float64Array(0)
let owner = new Int32Array(0)

// `pixels` is null for a tile the file leaves out, whose pixels are zeros
// (the TIFF fill value).
export function measureTileCells(
  pixels: ArrayLike<number> | null,
  decodedWidth: number,
  decodedHeight: number,
  cells: TileCellDiscs,
  options: TileCellMeasureOptions,
): TileCellSums {
  const cellCount = cells.x.length
  const sum = new Float64Array(cellCount)
  const count = new Uint32Array(cellCount)
  const above = new Uint32Array(cellCount)
  const width = Math.max(
    0,
    Math.min(options.width, pixels === null ? options.width : decodedWidth),
  )
  const height = Math.max(
    0,
    Math.min(options.height, pixels === null ? options.height : decodedHeight),
  )
  const size = width * height

  if (size === 0 || cellCount === 0) {
    return { sum, count, above }
  }

  if (nearest.length < size) {
    nearest = new Float64Array(size)
    owner = new Int32Array(size)
  }

  nearest.fill(Infinity, 0, size)
  owner.fill(-1, 0, size)

  // Each pixel goes to the disc it is nearest the centre of, relative to the
  // disc's radius, with distances in pixel widths.
  const yScale = options.yScale

  for (let cell = 0; cell < cellCount; cell += 1) {
    const cx = cells.x[cell] ?? 0
    const cy = cells.y[cell] ?? 0
    const radius = cells.radius[cell] ?? 0
    const radiusY = radius / yScale

    if (!(radius > 0) || !Number.isFinite(radius + radiusY + cx + cy)) {
      continue
    }

    const radiusSquared = radius * radius
    const x0 = Math.max(0, Math.ceil(cx - radius - 0.5))
    const x1 = Math.min(width - 1, Math.floor(cx + radius - 0.5))
    const y0 = Math.max(0, Math.ceil(cy - radiusY - 0.5))
    const y1 = Math.min(height - 1, Math.floor(cy + radiusY - 0.5))

    for (let py = y0; py <= y1; py += 1) {
      const dy = (py + 0.5 - cy) * yScale
      const dySquared = dy * dy
      const rowStart = py * width

      for (let px = x0; px <= x1; px += 1) {
        const dx = px + 0.5 - cx
        const distanceSquared = dx * dx + dySquared

        if (distanceSquared > radiusSquared) {
          continue
        }

        const relative = distanceSquared / radiusSquared
        const index = rowStart + px

        if (relative < (nearest[index] ?? Infinity)) {
          nearest[index] = relative
          owner[index] = cell
        }
      }
    }
  }

  const threshold = options.threshold

  for (let py = 0; py < height; py += 1) {
    const rowStart = py * width
    const pixelRowStart = py * decodedWidth

    for (let px = 0; px < width; px += 1) {
      const cell = owner[rowStart + px] ?? -1

      if (cell < 0) {
        continue
      }

      const value = pixels === null ? 0 : (pixels[pixelRowStart + px] ?? 0)
      sum[cell] = (sum[cell] ?? 0) + value
      count[cell] = (count[cell] ?? 0) + 1

      if (value >= threshold) {
        above[cell] = (above[cell] ?? 0) + 1
      }
    }
  }

  return { sum, count, above }
}
