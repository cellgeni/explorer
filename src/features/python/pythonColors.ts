// Colours for the Python console's colour layers (plan 29-D7): a single hue,
// a ramp from pale to that hue, or a named colour map. Python checks names
// and sends colours as "#rrggbb" (explorer/_colors.py).

export type PythonRgb = readonly [number, number, number]

// matplotlib's maps at 17 even stops (matplotlib 3.11), the names
// explorer/_colors.py CMAPS accepts.
// prettier-ignore
const COLOR_MAPS: Readonly<Record<string, readonly string[]>> = {
  viridis: [
    '#440154', '#48186a', '#472d7b', '#424086', '#3b528b', '#33638d', '#2c728e',
    '#26828e', '#21918c', '#1fa088', '#28ae80', '#3fbc73', '#5ec962', '#84d44b',
    '#addc30', '#d8e219', '#fde725',
  ],
  magma: [
    '#000004', '#0a0822', '#1d1147', '#36106b', '#51127c', '#6a1c81', '#832681',
    '#9c2e7f', '#b73779', '#d0416f', '#e75263', '#f56b5c', '#fc8961', '#fea772',
    '#fec488', '#fde2a3', '#fcfdbf',
  ],
  inferno: [
    '#000004', '#0b0724', '#210c4a', '#3d0965', '#57106e', '#71196e', '#8a226a',
    '#a32c61', '#bc3754', '#d24644', '#e45a31', '#f1731d', '#f98e09', '#fcac11',
    '#f9cb35', '#f2ea69', '#fcffa4',
  ],
  plasma: [
    '#0d0887', '#310597', '#4c02a1', '#6600a7', '#7e03a8', '#9511a1', '#aa2395',
    '#bc3587', '#cc4778', '#da5a6a', '#e66c5c', '#f0804e', '#f89540', '#fdac33',
    '#fdc527', '#f8df25', '#f0f921',
  ],
  cividis: [
    '#00224e', '#002e6a', '#1a386f', '#32436d', '#434e6c', '#535a6d', '#61656f',
    '#6f7073', '#7d7c78', '#8c8878', '#9b9476', '#aba072', '#bcae6c', '#cdbb63',
    '#dec958', '#f0d846', '#fee838',
  ],
  turbo: [
    '#30123b', '#4040a2', '#466be3', '#4294ff', '#28bceb', '#18ddc2', '#32f298',
    '#6dfe62', '#a4fc3c', '#cdec34', '#eecf3a', '#fdac34', '#fb7e21', '#eb500e',
    '#d02f05', '#a91601', '#7a0403',
  ],
}

// How far toward white a single-hue ramp starts.
const PALE_MIX = 0.85
const WHITE: PythonRgb = [255, 255, 255]

export function parseHexColor(hex: string): PythonRgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return null
  const value = Number.parseInt(match[1] ?? '', 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function rgbHex(rgb: PythonRgb): string {
  return `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

export function isPythonColorMap(name: string): boolean {
  return Object.hasOwn(COLOR_MAPS, name)
}

// A ramp's stops, low first: a colour map's, or pale to `color`.
export function pythonRampStops(
  ramp: { readonly color: PythonRgb } | { readonly cmap: string },
): readonly PythonRgb[] {
  if ('cmap' in ramp) {
    return (COLOR_MAPS[ramp.cmap] ?? COLOR_MAPS.viridis ?? []).map(
      (hex) => parseHexColor(hex) ?? WHITE,
    )
  }
  return [mix(ramp.color, WHITE, PALE_MIX), ramp.color]
}

// RGB for each value, over vmin to vmax (the top end when they are equal).
// NaN takes the ramp's low end, before any reverse: the palest colour of a
// single-hue ramp.
export function pythonRampColors(
  values: Float32Array,
  stops: readonly PythonRgb[],
  range: { readonly vmin: number; readonly vmax: number; readonly reverse: boolean },
): Uint8Array {
  const colors = new Uint8Array(values.length * 3)
  const span = range.vmax - range.vmin
  const last = stops.length - 1

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN
    let t: number
    if (Number.isNaN(value)) {
      t = 0
    } else {
      t = span > 0 ? (value - range.vmin) / span : 1
      t = Math.min(1, Math.max(0, t))
      if (range.reverse) t = 1 - t
    }
    const position = t * last
    const low = Math.min(last, Math.floor(position))
    const high = Math.min(last, low + 1)
    const color = mix(stops[low] ?? WHITE, stops[high] ?? WHITE, position - low)
    colors[index * 3] = color[0]
    colors[index * 3 + 1] = color[1]
    colors[index * 3 + 2] = color[2]
  }

  return colors
}

// A CSS gradient of the ramp as drawn from vmin to vmax.
export function pythonRampGradient(
  stops: readonly PythonRgb[],
  reverse: boolean,
): string {
  const ordered = reverse ? [...stops].reverse() : stops
  return `linear-gradient(90deg, ${ordered.map(rgbHex).join(', ')})`
}

function mix(from: PythonRgb, to: PythonRgb, amount: number): PythonRgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ]
}
