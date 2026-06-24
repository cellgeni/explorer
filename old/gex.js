/**
 * gex.js — Gene expression extraction for Xenium bundles
 *
 * Three sources, each using the correct zarr layout per the official spec:
 *
 * ┌─────────────────────────────┬────────────────────────────────────────────────────────────┐
 * │ Source                      │ What it contains                                           │
 * ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ transcripts.parquet         │ One row per transcript. cell_id (string), feature_name,    │
 * │                             │ x/y/z_location, qv, overlaps_nucleus, is_gene, …           │
 * │                             │ → Spatial DuckDB query, no cell-list limit.                │
 * ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ transcripts.zarr.zip        │ grids/0/{X,Y}/gene_identity  uint16 — gene index per tx    │
 * │                             │ grids/0/{X,Y}/location       float32 — x,y,z in µm        │
 * │                             │ grids/0/{X,Y}/quality_score  float32 — Q-score             │
 * │                             │ grids/0/{X,Y}/valid          uint8   — 1 if passes filter  │
 * │                             │ Root attrs: gene_names[], number_genes                     │
 * │                             │ density/gene — spatial density BINS (not per-cell!)        │
 * │                             │ → Enumerate grid tiles, filter by bbox+qv, group by gene.  │
 * ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ cell_feature_matrix.zarr.zip│ cell_features/                                             │
 * │                             │   csc/indptr  uint32 len=C+1  ← per-CELL slice pointer    │
 * │                             │   csc/indices uint16          ← feature (gene) index       │
 * │                             │   csc/data    uint32          ← count                      │
 * │                             │   cell_id     uint32[:,2]     ← [prefix, suffix] integers  │
 * │                             │ Attrs: feature_keys[], feature_types[]                     │
 * │                             │ NOTE: top-level indptr/indices/data is CSR (feature-major) │
 * │                             │ → Use csc/ for per-cell slicing (XOA ≥ v3.1).             │
 * └─────────────────────────────┴────────────────────────────────────────────────────────────┘
 *
 * All sources return the same shape:
 *   {
 *     geneNames: string[],       // full ordered gene list
 *     cells: Map<cellId:string, {
 *       geneNames: string[],     // parallel sparse arrays (nonzero only)
 *       counts:    number[],
 *     }>
 *   }
 */

import { ZipFileStore } from "@zarrita/storage";
import * as zarr from "zarrita";

// ─── Cell ID helpers (official spec) ─────────────────────────────────────────
// Integer prefix → 8-char hex → shift [0-9a-f] → [a-p] → append "-{suffix}"

const TO_SHIFTED   = Object.fromEntries([..."0123456789abcdef"].map((c, i) => [c, "abcdefghijklmnop"[i]]));
const FROM_SHIFTED = Object.fromEntries([..."abcdefghijklmnop"].map((c, i) => [c, "0123456789abcdef"[i]]));

export function intToCellId(prefix, suffix = 1) {
    const hex = (prefix >>> 0).toString(16).padStart(8, "0");
    return [...hex].map(c => TO_SHIFTED[c]).join("") + "-" + suffix;
}

export function cellIdToInt(cellId) {
    const [enc, suf] = cellId.split("-");
    const hex = [...enc].map(c => FROM_SHIFTED[c]).join("");
    return { prefix: parseInt(hex, 16) >>> 0, suffix: parseInt(suf, 10) };
}

// ─── aggregation helper ───────────────────────────────────────────────────────

/**
 * Aggregate per-cell sparse GEX into sorted [{gene, count}] for heatmap.
 * @param {Map} cells
 * @returns {{gene:string, count:number}[]}
 */
export function aggregateGex(cells) {
    const totals = new Map();
    for (const { geneNames, counts } of cells.values()) {
        for (let i = 0; i < geneNames.length; i++) {
            totals.set(geneNames[i], (totals.get(geneNames[i]) ?? 0) + counts[i]);
        }
    }
    return [...totals.entries()]
        .map(([gene, count]) => ({ gene, count }))
        .sort((a, b) => b.count - a.count);
}

// Ray-casting point-in-polygon (data space)
function pointInPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y;
        const xj = pts[j].x, yj = pts[j].y;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

// ─── Source 1: transcripts.parquet ───────────────────────────────────────────
//
// Two scope modes:
//   'spatial'    — filter by x_location/y_location geometry (includes extracellular)
//   'cells-only' — filter by cell_id IN (...) — matches CFM counts exactly
//
// Both support circle and polygon selections.

/**
 * @param {object} conn
 * @param {string} url          URL to transcripts.parquet
 * @param {object} selection    { kind:'circle', cx, cy, radius } | { kind:'polygon', points:[{x,y}] }
 * @param {string} scope        'spatial' | 'cells-only'
 * @param {string[]} cellIds    cell_ids from spatial cell query (used for 'cells-only')
 * @param {number} [minQv=20]
 * @returns {{ geneNames:string[], cells:Map }}
 */
export async function gexFromTranscriptsParquet(conn, url, selection, scope = 'spatial', cellIds = [], minQv = 20) {
    let whereSql, params;

    if (scope === 'cells-only') {
        whereSql = `cell_id IN (SELECT * FROM UNNEST( ? ))`;
        params   = [url, cellIds, minQv];
    } else {
        if (selection.kind === 'circle') {
            const { cx, cy, radius: r } = selection;
            // Bbox pre-filter enables row-group pushdown; exact test eliminates corners
            whereSql = `x_location BETWEEN ? AND ?
                    AND y_location BETWEEN ? AND ?
                    AND (x_location-?)*(x_location-?) + (y_location-?)*(y_location-?) <= ?`;
            params   = [url, cx-r, cx+r, cy-r, cy+r, cx, cx, cy, cy, r*r, minQv];
        } else {
            const xs = selection.points.map(p => p.x), ys = selection.points.map(p => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);
            const ring = selection.points.map(p => `${p.x} ${p.y}`).join(', ');
            const wkt  = `POLYGON((${ring}, ${selection.points[0].x} ${selection.points[0].y}))`;
            whereSql = `x_location BETWEEN ? AND ?
                    AND y_location BETWEEN ? AND ?
                    AND ST_Within(ST_Point(x_location, y_location), ST_GeomFromText(?))`;
            params   = [url, minX, maxX, minY, maxY, wkt, minQv];
        }
    }

    const stmt = await conn.prepare(`
        SELECT  cell_id,
                feature_name    AS gene,
                COUNT(*)        AS count
        FROM    read_parquet( ? )
        WHERE   ${whereSql}
          AND   qv      >= ?
          AND   is_gene  = true
        GROUP BY cell_id, feature_name
        ORDER BY cell_id, count DESC
    `);
    const res  = await stmt.query(...params);
    const rows = res.toArray().map(r =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))
    );

    const geneSet   = new Set(rows.map(r => r.gene));
    const geneNames = [...geneSet].sort();
    const cells     = new Map();

    for (const { cell_id, gene, count } of rows) {
        if (!cell_id) continue;
        if (!cells.has(cell_id)) cells.set(cell_id, { geneNames: [], counts: [] });
        const c = cells.get(cell_id);
        c.geneNames.push(gene);
        c.counts.push(count);
    }

    return { geneNames, cells };
}

// ─── Source 2: transcripts.zarr.zip ──────────────────────────────────────────
//
// Official layout (grids/0/{X,Y}):
//   gene_identity  uint16  — index into root attr gene_names[]
//   location       float32 — [x, y, z] in µm, shape [N, 3]
//   quality_score  float32 — calibrated Q-score, shape [N]
//   valid          uint8   — always 1 in final output
//
// density/gene is a SPATIAL DENSITY GRID (10µm bins), NOT per-cell counts.
// We use grids/0 (full resolution) and filter by bounding box + Q-score.
// Transcripts.zarr.zip has NO cell assignment — result is gene totals over
// the region (not per-cell), unless cross-referenced with cells.zarr.zip masks.

// ─── Source 2: transcripts.zarr.zip ──────────────────────────────────────────

/**
 * @param {string} url        URL to transcripts.zarr.zip
 * @param {object} selection  { kind:'circle', cx, cy, radius } | { kind:'polygon', points }
 * @param {number} [minQv=20]
 * @returns {{ geneNames:string[], cells:Map }}
 *   cells: single synthetic entry "region" — no cell assignment in this file
 */
export async function gexFromTranscriptsZarr(url, selection, minQv = 20) {
    const store = ZipFileStore.fromUrl(url);
    const root  = await zarr.open(store);
    const attrs = root.attrs;

    const geneNames = attrs?.gene_names ?? attrs?.feature_names ?? [];

    const gridsAttrs = (await zarr.open(root.resolve("grids"))).attrs;
    const level0Keys = gridsAttrs?.grid_keys?.[0] ?? [];

    const geneTotals = new Map();

    // Precompute bounding box for quick rejection
    let bbox, testFn;
    if (selection.kind === 'circle') {
        const { cx, cy, radius } = selection;
        const r2 = radius * radius;
        bbox   = { minX: cx - radius, maxX: cx + radius, minY: cy - radius, maxY: cy + radius };
        testFn = (x, y) => { const dx = x-cx, dy = y-cy; return dx*dx + dy*dy <= r2; };
    } else {
        // Polygon: compute bbox, then point-in-polygon via ray casting
        const pts = selection.points;
        bbox = {
            minX: Math.min(...pts.map(p => p.x)),
            maxX: Math.max(...pts.map(p => p.x)),
            minY: Math.min(...pts.map(p => p.y)),
            maxY: Math.max(...pts.map(p => p.y)),
        };
        testFn = (x, y) => pointInPolygon(x, y, pts);
    }

    for (const key of level0Keys) {
        const tileGroup = await zarr.open(root.resolve(`grids/0/${key}`));

        // Read locations first to decide if tile overlaps query circle at all
        // location shape: [N, 3]  columns: x, y, z
        const locArr  = await zarr.open(tileGroup.resolve("location"),       { kind: "array" });
        const qvArr   = await zarr.open(tileGroup.resolve("quality_score"),  { kind: "array" });
        const geneArr = await zarr.open(tileGroup.resolve("gene_identity"),  { kind: "array" });

        const N = locArr.shape[0];
        if (N === 0) continue;

        const locs  = (await zarr.get(locArr,  [null, null])).data;  // Float32Array, length N*3
        const qvs   = (await zarr.get(qvArr,   [null])).data;        // Float32Array, length N
        const genes = (await zarr.get(geneArr, [null])).data;        // Uint16Array,  length N

        for (let i = 0; i < N; i++) {
            const x = locs[i * 3];
            const y = locs[i * 3 + 1];
            if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) continue;
            if (!testFn(x, y)) continue;
            if (qvs[i] < minQv) continue;
            const gIdx = genes[i];
            if (gIdx === 65535) continue;
            geneTotals.set(gIdx, (geneTotals.get(gIdx) ?? 0) + 1);
        }
    }

    // Build result — single "region" pseudo-cell since zarr has no cell assignment
    const sparseGenes  = [];
    const sparseCounts = [];
    for (const [gIdx, count] of [...geneTotals.entries()].sort((a, b) => b[1] - a[1])) {
        sparseGenes.push(geneNames[gIdx] ?? `gene_${gIdx}`);
        sparseCounts.push(count);
    }

    const cells = new Map([["region", { geneNames: sparseGenes, counts: sparseCounts }]]);
    return { geneNames, cells };
}

// ─── Source 3: cell_feature_matrix.zarr.zip ──────────────────────────────────
//
// Official layout (XOA ≥ v3.1):
//   cell_features/csc/indptr   uint32 [C+1]  — per-CELL slice pointers
//   cell_features/csc/indices  uint16 [nnz]  — feature (gene) index per nonzero
//   cell_features/csc/data     uint32 [nnz]  — count per nonzero
//   cell_features/cell_id      uint32 [C, 2] — [prefix, suffix] integer pairs
//   Attrs: feature_keys[], feature_types[], number_cells, number_features
//
// NOTE: The top-level indptr/indices/data (without csc/) is CSR (feature-major):
//   indptr has length F+1, rows=features, cols=cells.
//   For per-cell slicing you MUST use csc/.

/**
 * @param {string}   url
 * @param {string[]} cellIds        string cell_ids to extract
 * @returns {{ geneNames:string[], cells:Map }}
 */
export async function gexFromCellFeatureMatrixZarr(url, cellIds) {
    const store        = ZipFileStore.fromUrl(url);
    const root         = await zarr.open(store);
    const cellFeatures = await zarr.open(root.resolve("cell_features"));
    const attrs        = cellFeatures.attrs ?? {};

    const geneNames    = attrs.feature_keys   ?? [];
    const featureTypes = Array.isArray(attrs.feature_types) ? attrs.feature_types : [];

    // Name patterns that are never gene expression features
    const NON_GENE = /^(Total transcripts|NegControl|Unassigned|Deprecated|BLANK_|Genomic|antisense_)/i;

    // Build set of gene-only feature indices.
    // When feature_types is present: keep only "Gene Expression" features.
    // When absent: keep everything except known non-gene names.
    const geneFeatureIndices = new Set(
        geneNames
            .map((name, i) => {
                if (NON_GENE.test(name)) return -1;
                if (featureTypes.length > 0) {
                    const t = (featureTypes[i] ?? '').toLowerCase();
                    return (t === 'gene expression' || t === 'gene') ? i : -1;
                }
                return i;
            })
            .filter(i => i >= 0)
    );



    // Read cell_id integer pairs → build string→rowIndex map
    // cell_id shape is [C, 2]: first column = prefix, second = suffix
    const cellIdArr  = await zarr.open(cellFeatures.resolve("cell_id"), { kind: "array" });
    const cellIdData = (await zarr.get(cellIdArr, [null, null])).data;  // Uint32Array flat [prefix0,suffix0,prefix1,suffix1,…]
    // shape[0] is C (number of cells), shape[1] is 2
    const nCells = cellIdArr.shape[0];
    const stride = cellIdArr.shape[1] ?? 2;   // should be 2; guard against unexpected shape

    const cellIdToRow = new Map();
    for (let i = 0; i < nCells; i++) {
        const prefix  = cellIdData[i * stride];
        const suffix  = cellIdData[i * stride + 1];
        const strId   = intToCellId(prefix, suffix);
        cellIdToRow.set(strId, i);
    }

    // Resolve target rows, sorted for contiguous read
    const targets = cellIds
        .map(id => ({ id, row: cellIdToRow.get(id) ?? -1 }))
        .filter(t => t.row >= 0)
        .sort((a, b) => a.row - b.row);

    if (!targets.length) {
        console.warn('gexFromCellFeatureMatrixZarr: no matching cell IDs in zarr. Sample cellId:', cellIds[0], '→ sample zarr id:', [...cellIdToRow.keys()][0]);
        return { geneNames: geneNames.filter((_, i) => geneFeatureIndices.has(i)), cells: new Map() };
    }

    // Open CSC arrays (per-cell slicing)
    const indptrArr  = await zarr.open(cellFeatures.resolve("csc/indptr"),  { kind: "array" });
    const indicesArr = await zarr.open(cellFeatures.resolve("csc/indices"), { kind: "array" });
    const dataArr    = await zarr.open(cellFeatures.resolve("csc/data"),    { kind: "array" });

    const firstRow   = targets[0].row;
    const lastRow    = targets[targets.length - 1].row;

    // Read indptr slice: [firstRow … lastRow+1] inclusive (one extra for end pointer)
    const indptrSlice = (await zarr.get(indptrArr, [zarr.slice(firstRow, lastRow + 2)])).data;

    const globalStart = Number(indptrSlice[0]);
    const globalEnd   = Number(indptrSlice[indptrSlice.length - 1]);

    const allIndices = globalEnd > globalStart
        ? (await zarr.get(indicesArr, [zarr.slice(globalStart, globalEnd)])).data
        : new Uint16Array(0);
    const allData    = globalEnd > globalStart
        ? (await zarr.get(dataArr,    [zarr.slice(globalStart, globalEnd)])).data
        : new Uint32Array(0);

    const cells = new Map();
    for (const { id, row } of targets) {
        const start  = Number(indptrSlice[row - firstRow])     - globalStart;
        const end    = Number(indptrSlice[row - firstRow + 1]) - globalStart;
        const gns    = [];
        const cnts   = [];
        for (let j = start; j < end; j++) {
            const fIdx = allIndices[j];
            if (!geneFeatureIndices.has(fIdx)) continue;
            gns.push(geneNames[fIdx] ?? `feature_${fIdx}`);
            cnts.push(Number(allData[j]));
        }
        cells.set(id, { geneNames: gns, counts: cnts });
    }

    // Fill in any cellIds that weren't found
    for (const id of cellIds) {
        if (!cells.has(id)) cells.set(id, { geneNames: [], counts: [] });
    }

    return { geneNames: geneNames.filter((_, i) => geneFeatureIndices.has(i)), cells };
}
