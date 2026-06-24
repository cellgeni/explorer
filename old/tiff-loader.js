/**
 * tiff-loader.js — OME-TIFF pyramid loader via HTTP Range requests.
 *
 * Uses window.GeoTIFF (loaded from CDN in index.html) to avoid Vite's
 * deferred-array bundling issue with the npm geotiff package.
 *
 * On openTiff(): fetches IFD 0 + all SubIFD headers in parallel → builds a
 * flat chunk index: "lvl/row/col" → { offset, length }.
 * fetchTileBytes() is then a synchronous Map lookup + one Range request.
 * No IFD round-trips during pan/zoom.
 */

function parsePixelSize(desc) {
    if (!desc) return 0.2125;
    const m = desc.match(/PhysicalSizeX="([^"]+)"/);
    const v = m ? parseFloat(m[1]) : NaN;
    return (v > 0) ? v : 0.2125;
}

export async function openTiff(url) {
    // Use CDN GeoTIFF — works exactly like tiff-test.html
    const { fromUrl } = window.GeoTIFF;

    const tiff = await fromUrl(url, { cache: true, allowFullFile: false });
    const img0 = await tiff.getImage(0);
    const fd0  = img0.fileDirectory;

    const W       = img0.getWidth();
    const H       = img0.getHeight();
    const tileW   = img0.getTileWidth()  || 256;
    const tileH   = img0.getTileHeight() || 256;
    const µmPerPx = parsePixelSize(fd0.ImageDescription);
    const subIFDs = fd0.SubIFDs ?? [];

    console.debug(`[tiff] ${W}×${H} tile=${tileW}×${tileH} SubIFDs=${subIFDs.length} TileOffsets=${fd0.TileOffsets?.length}`);
    console.debug(`[tiff] µmPerPx=${µmPerPx} → slide ${(W*µmPerPx).toFixed(0)}×${(H*µmPerPx).toFixed(0)} µm`);

    // ── Build chunk index — all levels in parallel ─────────────────────────────
    const chunkIndex = new Map();  // "lvl/row/col" → { offset, length }
    const levelMeta  = new Map();  // lvl → { w, h, nCols, nRows }

    // Level 0
    const nC0 = Math.ceil(W / tileW);
    levelMeta.set(0, { w: W, h: H, nCols: nC0, nRows: Math.ceil(H / tileH) });
    fd0.TileOffsets.forEach((off, idx) => {
        chunkIndex.set(`0/${Math.floor(idx / nC0)}/${idx % nC0}`,
            { offset: Number(off), length: Number(fd0.TileByteCounts[idx]) });
    });

    // SubIFD levels — all in parallel
    const t0 = performance.now();
    await Promise.all(subIFDs.map(async (subOff, i) => {
        const lvl    = i + 1;
        const parsed = await tiff.parseFileDirectoryAt(Number(subOff));
        const fd     = parsed.fileDirectory ?? parsed;
        const w = fd.ImageWidth, h = fd.ImageLength;
        const nCols = Math.ceil(w / tileW), nRows = Math.ceil(h / tileH);
        levelMeta.set(lvl, { w, h, nCols, nRows });
        fd.TileOffsets.forEach((off, idx) => {
            chunkIndex.set(`${lvl}/${Math.floor(idx / nCols)}/${idx % nCols}`,
                { offset: Number(off), length: Number(fd.TileByteCounts[idx]) });
        });
    }));

    const numLevels = 1 + subIFDs.length;
    console.debug(`[tiff] index: ${chunkIndex.size} chunks, ${numLevels} levels, ${(performance.now()-t0).toFixed(0)}ms`);

    return new TiffLoader({ url, chunkIndex, levelMeta, µmPerPx, tileW, tileH, numLevels, imgW: W, imgH: H });
}

export class TiffLoader {
    constructor({ url, chunkIndex, levelMeta, µmPerPx, tileW, tileH, numLevels, imgW, imgH }) {
        this.url       = url;
        this._chunks   = chunkIndex;
        this._meta     = levelMeta;
        this.µmPerPx   = µmPerPx;
        this.tileW     = tileW;
        this.tileH     = tileH;
        this.numLevels = numLevels;
        this.imgW      = imgW;
        this.imgH      = imgH;
        this.slideW_µm = imgW * µmPerPx;
        this.slideH_µm = imgH * µmPerPx;
    }

    bestLevel(deckScale) {
        for (let lvl = this.numLevels - 1; lvl >= 0; lvl--)
            if (this.tileW * deckScale / Math.pow(2, lvl) >= 128) return lvl;
        return this.numLevels - 1;
    }

    /** Synchronous — returns tiles immediately from pre-built level metadata. */
    tilesForBbox(level, bbox) {
        const meta = this._meta.get(level);
        if (!meta) return [];
        const s = this.µmPerPx * Math.pow(2, level);
        const { nCols, nRows } = meta;
        // No Y-flip: bbox.minY/maxY map directly to TIFF rows
        const col0 = Math.max(0,       Math.floor(Math.max(0, bbox.minX / s) / this.tileW));
        const col1 = Math.min(nCols-1, Math.floor(Math.max(0, bbox.maxX / s - 1e-9) / this.tileW));
        const row0 = Math.max(0,       Math.floor(Math.max(0, bbox.minY / s) / this.tileH));
        const row1 = Math.min(nRows-1, Math.floor(Math.max(0, bbox.maxY / s - 1e-9) / this.tileH));
        const tiles = [];
        for (let row = row0; row <= row1; row++)
            for (let col = col0; col <= col1; col++)
                tiles.push({ col, row });
        return tiles;
    }

    tileBounds(level, col, row) {
        const s = this.µmPerPx * Math.pow(2, level);
        // Xenium y_centroid=0 is the physical top of the slide.
        // The app stores y_centroid as-is in Y-up data space, so y=0 is at the bottom
        // of the view and y=slideH_µm is at the top — but y_centroid=0 (top of tissue)
        // appears at the BOTTOM of the view. TIFF row 0 is also the physical top.
        // So row 0 → y=0, row N → y=slideH_µm (no flip — same direction as y_centroid).
        const left   =  col      * this.tileW * s;
        const right  = (col + 1) * this.tileW * s;
        const bottom =  row      * this.tileH * s;
        const top    = (row + 1) * this.tileH * s;
        return [
            Math.max(0,              left),
            Math.max(0,              bottom),
            Math.min(this.slideW_µm, right),
            Math.min(this.slideH_µm, top),
        ];
    }

    /** Sync index lookup + one HTTP Range request. */
    async fetchTileBytes(level, col, row) {
        const chunk = this._chunks.get(`${level}/${row}/${col}`);
        if (!chunk) throw new Error(`No chunk for ${level}/${row}/${col}`);
        const resp = await fetch(this.url, {
            headers: { Range: `bytes=${chunk.offset}-${chunk.offset + chunk.length - 1}` }
        });
        return new Uint8Array(await resp.arrayBuffer());
    }
}
