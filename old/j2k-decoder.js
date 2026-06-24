/**
 * j2k-decoder.js — JPEG-2000 decoder via @cornerstonejs/codec-openjpeg WASM.
 * Pattern confirmed working in tiff-test.html.
 */

let _oj = null;

async function ensureDecoder() {
    if (_oj) return _oj;
    const { default: factory } = await import('@cornerstonejs/codec-openjpeg');
    if (typeof factory !== 'function') {
        throw new Error(`OpenJPEG factory not a function (${typeof factory}). Ensure @cornerstonejs/codec-openjpeg is in vite optimizeDeps.include`);
    }
    _oj = await factory();
    return _oj;
}

export async function warmDecoder() {
    await ensureDecoder();
}

/**
 * Decode a raw J2K/JP2 bitstream → { pixels: Uint16Array, width, height }
 * Matches tiff-test.html decode() exactly.
 */
export async function decodeJ2K(bytes) {
    const oj      = await ensureDecoder();
    const decoder = new oj.J2KDecoder();

    decoder.getEncodedBuffer(bytes.length).set(bytes);
    decoder.decode();

    const fi  = decoder.getFrameInfo();
    const raw = decoder.getDecodedBuffer();

    // fi.bitsAllocated may be undefined — treat raw buffer as Uint16 for 16-bit data
    // (confirmed: Xenium DAPI tiles are 16-bit, raw.byteLength = width*height*2)
    const expectedPixels = fi.width * fi.height;
    const isU16 = raw.byteLength === expectedPixels * 2;

    const pixels = isU16
        ? new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
        : new Uint8Array( raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

    decoder.delete?.();

    return { pixels, width: fi.width, height: fi.height };
}

/**
 * Normalise pixels → 8-bit RGBA using 2nd–98th percentile window.
 * Shared lo/hi across tiles for consistent display (pass undefined to auto-calibrate).
 */
export function normaliseToRGBA(pixels, width, height, lo, hi) {
    if (lo === undefined || hi === undefined) {
        const step   = Math.max(1, Math.floor(pixels.length / 10_000));
        const sample = [];
        for (let i = 0; i < pixels.length; i += step) sample.push(pixels[i]);
        sample.sort((a, b) => a - b);
        lo = sample[Math.floor(sample.length * 0.02)] ?? 0;
        hi = sample[Math.floor(sample.length * 0.98)] ?? 65535;
        if (hi === lo) hi = lo + 1;
    }
    const range = hi - lo;
    const rgba  = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) {
        const v   = Math.round(((pixels[i] - lo) / range) * 255);
        const off = i * 4;
        rgba[off] = rgba[off+1] = rgba[off+2] = v;
        rgba[off+3] = 255;
    }
    return { rgba, lo, hi };
}
