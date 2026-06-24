/**
 * tile-cache.js
 *
 * LRU cache of decoded + normalised OME-TIFF tiles as ImageBitmaps.
 * Each entry: key = "level:col:row", value = { bitmap, bounds, state }
 *
 * State machine per tile:
 *   'empty'   → not yet requested
 *   'loading' → fetch + decode in flight
 *   'ready'   → ImageBitmap available for BitmapLayer
 *   'error'   → fetch/decode failed — don't retry
 */

import { decodeJ2K, normaliseToRGBA } from './j2k-decoder.js';


const MAX_TILES = 150;   // ~75MB at 1024² 8-bit RGBA

export class TileCache {
    constructor() {
        this._cache   = new Map();  // key → { state, bitmap, bounds }
        this._order   = [];         // LRU: oldest first
        // Display window — calibrated from first decoded tile, reused for all
        this._lo      = undefined;
        this._hi      = undefined;
        // Brightness/contrast multipliers applied on top of the window
        this.brightness = 1.0;   // [0.5 .. 2.0]
        this.contrast   = 1.0;   // [0.5 .. 2.0]
    }

    key(level, col, row) { return `${level}:${col}:${row}`; }

    get(level, col, row) { return this._cache.get(this.key(level, col, row)); }

    _touch(k) {
        const idx = this._order.indexOf(k);
        if (idx >= 0) this._order.splice(idx, 1);
        this._order.push(k);
    }

    _evict() {
        while (this._order.length > MAX_TILES) {
            const oldest = this._order.shift();
            const entry  = this._cache.get(oldest);
            entry?.bitmap?.close?.();
            this._cache.delete(oldest);
        }
    }

    /**
     * Request a tile. Starts loading if not already cached.
     * Calls onReady() when the tile becomes available.
     *
     * @param {TiffLoader} loader
     * @param {number}     level
     * @param {number}     col
     * @param {number}     row
     * @param {Function}   onReady   — called with no args when tile is ready
     */
    request(loader, level, col, row, onReady) {
        const k = this.key(level, col, row);
        const existing = this._cache.get(k);
        if (existing) {
            this._touch(k);
            if (existing.state === 'ready') onReady();
            return;  // already loading, ready, or errored
        }

        const bounds = loader.tileBounds(level, col, row);
        const entry  = { state: 'loading', bitmap: null, bounds };
        this._cache.set(k, entry);
        this._order.push(k);
        this._evict();

        this._load(loader, level, col, row, k, entry, onReady);
    }

    async _load(loader, level, col, row, k, entry, onReady) {
        try {
            // All Xenium OME-TIFFs are J2K — fetch raw bytes, decode with openjpeg
            const bytes  = await loader.fetchTileBytes(level, col, row);
            const result = await decodeJ2K(bytes);
            const { pixels, width, height } = result;

            // Normalise 16-bit → 8-bit using shared display window
            const { rgba, lo, hi } = normaliseToRGBA(
                pixels, width, height, this._lo, this._hi
            );

            // Calibrate display window from the first tile decoded
            if (this._lo === undefined) { this._lo = lo; this._hi = hi; }

            const imageData = new ImageData(rgba, width, height);
            const bitmap    = await createImageBitmap(imageData);

            // Check the entry wasn't evicted while we were loading
            if (!this._cache.has(k)) { bitmap.close?.(); return; }

            entry.state  = 'ready';
            entry.bitmap = bitmap;
            onReady();

        } catch (err) {
            console.warn(`TileCache: failed to load tile ${k}:`, err);
            entry.state = 'error';
        }
    }

    /**
     * Return all ready tiles as deck.gl BitmapLayer props arrays.
     * Only returns tiles whose bounds overlap the given bbox (in µm).
     */
    readyTiles(bboxMu) {
        const result = [];
        for (const [k, entry] of this._cache) {
            if (entry.state !== 'ready') continue;
            const [l, b, r, t] = entry.bounds;
            // Rough bbox overlap check
            if (r < bboxMu.minX || l > bboxMu.maxX ||
                t < bboxMu.minY || b > bboxMu.maxY) continue;
            result.push({ id: k, image: entry.bitmap, bounds: entry.bounds });
        }
        return result;
    }

    /** Discard all cached tiles (call when loading a new dataset). */
    clear() {
        for (const entry of this._cache.values()) entry.bitmap?.close?.();
        this._cache.clear();
        this._order = [];
        this._lo = undefined;
        this._hi = undefined;
    }

    /** Recompute RGBA for all cached tiles after brightness/contrast change. */
    async invalidateDisplay(loader) {
        this._lo = undefined;
        this._hi = undefined;
        // Re-request all currently-ready tiles
        const keys = [...this._cache.keys()];
        for (const k of keys) {
            const entry = this._cache.get(k);
            if (entry?.state === 'ready') {
                entry.bitmap?.close?.();
                this._cache.delete(k);
                const idx = this._order.indexOf(k);
                if (idx >= 0) this._order.splice(idx, 1);
            }
        }
    }
}
