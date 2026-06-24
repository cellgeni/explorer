import getDuckDb from "./quack";
import {
    gexFromTranscriptsParquet,
    gexFromCellFeatureMatrixZarr,
    aggregateGex,
} from "./gex";
import { ZipFileStore } from "@zarrita/storage";
import * as zarr from "zarrita";
import { openTiff } from "./tiff-loader.js";
import { TileCache } from "./tile-cache.js";

// deck.gl loaded from CDN in index.html — available as window.deck
const { Deck, OrthographicView, ScatterplotLayer, PolygonLayer } = window.deck;

// ─── State ────────────────────────────────────────────────────────────────────
let conn            = null;
let db              = null;
let activeSource    = 'cfm-zarr';
let activeTab       = 'heatmap';
let activeScope     = 'spatial';
let drawMode        = 'circle';
let dataExtent      = null;
let totalCells      = 0;
let localCellsFile  = null;
let localBdryFile   = null;   // cell_boundaries.parquet in DuckDB VFS
let bdryLoading     = false;

// deck.gl view state (in µm coords)
let viewState = { target: [0, 0, 0], zoom: 0, minZoom: -4, maxZoom: 10 };

// Viewport data cache
let dotData   = [];   // [{ x, y }] — ScatterplotLayer
let polyData  = [];   // [{ cellId, polygon: [[x,y],…], selected, colour }] — PolygonLayer

// Selection
let selectedCells   = [];
let lastGexResult   = null;
let selection       = null;
const SELECTED_SET  = new Set();

// Highlight
let cellColours  = null;
let colourMode   = 'palette';
let selectedGenes  = [];
let allGenesSorted = [];

// Cluster colouring (from analysis.zarr.zip)
let clusterCellColours  = null;
let clusterGroupings    = [];
let activeClusterMethod = 0;

// ── Morphology image state ────────────────────────────────────────────────────
let tiffLoader       = null;
let tileCache        = new TileCache();
let morphologyOn     = false;
let morphDebounce    = null;
let cellOpacity      = 1.0;    // 0..1, applied to deck.gl canvas opacity
const PALETTE = [
    '#f87171','#fb923c','#facc15','#4ade80',
    '#34d399','#22d3ee','#60a5fa','#a78bfa',
    '#f472b6','#e879f9','#86efac','#fda4af',
];
const geneCustomColours = new Map();

// Magic Lens
let magicLensActive  = false;
let lensPos          = null;
let lensData         = null;
let lensDebounceFast = null;
let lensDebounceGex  = null;
let lensQueryVer     = 0;

// Interaction state (for overlay canvas)
let isPanning       = false;
let panStart        = { x: 0, y: 0 };
let panViewState    = null;
let isDrawingCircle = false;
let circleStart     = { x: 0, y: 0 };
let isDrawingPoly   = false;
let polyPoints      = [];
let mouseScreen     = null;

// Debounce handles
let vpDebounce   = null;
let polyDebounce = null;
let polyVersion  = 0;    // stale-response guard for polygon fetches

const POLY_SCALE_THRESHOLD = 1.8;   // µm→px scale; ~15px cell diameter before polygons show

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const deckContainer  = document.getElementById('deck-container');
const overlay        = document.getElementById('overlay-canvas');
const octx           = overlay.getContext('2d');
const morphCanvas    = document.getElementById('morph-canvas');
const mctx           = morphCanvas.getContext('2d');
const dbStatus       = document.getElementById('db-status');
const datasetInput   = document.getElementById('dataset-input');
const datasetLabel   = document.getElementById('dataset-label');
const loadBtn        = document.getElementById('loadBtn');
const queryBtn       = document.getElementById('queryBtn');
const clearBtn       = document.getElementById('clearBtn');
const radiusSlider   = document.getElementById('radiusSlider');
const radiusVal      = document.getElementById('radiusVal');
const statCells      = document.getElementById('stat-cells');
const statTotal      = document.getElementById('stat-total');
const statTx         = document.getElementById('stat-tx');
const statTotalTx    = document.getElementById('stat-total-tx');
const heatmapWrap    = document.getElementById('heatmap-wrap');
const matrixWrap     = document.getElementById('matrix-wrap');
const highlightWrap  = document.getElementById('highlight-wrap');
const highlightTabBtn = document.getElementById('highlightTabBtn');
const exportBtn      = document.getElementById('exportBtn');
const logEl          = document.getElementById('log');
const circleControls = document.getElementById('circle-controls');
const polygonHint    = document.getElementById('polygon-hint');
const progressWrap   = document.getElementById('load-progress-wrap');
const progressFill   = document.getElementById('load-progress-fill');
const progressLabel  = document.getElementById('load-progress-label');
const geneSearch     = document.getElementById('gene-search');
const geneChips      = document.getElementById('gene-chips');
const geneListEl     = document.getElementById('gene-list');
const applyHighlightBtn  = document.getElementById('applyHighlightBtn');
const clearHighlightBtn  = document.getElementById('clearHighlightBtn');
const highlightLegend    = document.getElementById('highlight-legend');
const legendGradient     = document.getElementById('legend-gradient');
const legendMax          = document.getElementById('legend-max');
const magicLensBtn       = document.getElementById('magicLensBtn');
const morphologySection  = document.getElementById('morphology-section');
const morphologyToggleBtn= document.getElementById('morphologyToggleBtn');
const morphologyControls = document.getElementById('morphology-controls');
const brightnessSlider   = document.getElementById('brightnessSlider');
const brightnessVal      = document.getElementById('brightnessVal');
const contrastSlider     = document.getElementById('contrastSlider');
const contrastVal        = document.getElementById('contrastVal');
const cellOpacitySlider  = document.getElementById('cellOpacitySlider');
const cellOpacityVal     = document.getElementById('cellOpacityVal');

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg, type = 'ok') {
    const e = document.createElement('div');
    e.className = `entry ${type}`;
    e.innerHTML = `<span class="mark">${type==='ok'?'✓':type==='err'?'✗':'●'}</span><span>${msg}</span>`;
    logEl.prepend(e);
}

function arrowToJS(row) {
    return Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v==='bigint'?Number(v):v]));
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
// deck.gl getFillColor / getLineColor expect [r,g,b,a] Uint8 arrays

function hexToRgba(hex, alpha = 255) {
    const n = parseInt(hex.replace('#',''), 16);
    return [(n>>16)&255, (n>>8)&255, n&255, alpha];
}

function cssToRgba(col, alpha = 255) {
    // supports '#rrggbb', '#rrggbbaa', 'rgb(r,g,b)', 'rgba(r,g,b,a)'
    if (col.startsWith('#')) {
        const n = parseInt(col.slice(1,7), 16);
        return [(n>>16)&255, (n>>8)&255, n&255, alpha];
    }
    const m = col.match(/[\d.]+/g);
    if (m) return [+m[0], +m[1], +m[2], alpha];
    return [128, 128, 128, alpha];
}

function viridis(t) {
    const stops = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
    const s = t*4, i = Math.min(3, Math.floor(s)), f = s-i;
    const [r1,g1,b1]=stops[i], [r2,g2,b2]=stops[i+1];
    return [Math.round(r1+(r2-r1)*f), Math.round(g1+(g2-g1)*f), Math.round(b1+(b2-b1)*f)];
}

// CSS string version for magic lens HUD
function viridisCSS(t) { const [r,g,b]=viridis(t); return `rgb(${r},${g},${b})`; }

// ─── Coordinate helpers ───────────────────────────────────────────────────────
// deck.gl OrthographicView with flipY:false uses Y-up (data space).
// Screen Y increases downward, so we negate Y when converting.
function currentScale()   { return Math.pow(2, viewState.zoom); }
function currentOffsetX() { return overlay.width/2  - viewState.target[0] *  currentScale(); }
function currentOffsetY() { return overlay.height/2 + viewState.target[1] *  currentScale(); }

function screenToData(sx, sy) {
    const s = currentScale();
    return { x:  (sx - currentOffsetX()) / s,
             y: -(sy - currentOffsetY()) / s };
}
function dataToScreen(dx, dy) {
    const s = currentScale();
    return { x:  dx * s + currentOffsetX(),
             y: -dy * s + currentOffsetY() };
}

// Viewport bbox in data coords — works with Y-up (tl.y > br.y, so we sort)
function viewportBbox() {
    const tl = screenToData(0, 0);
    const br = screenToData(overlay.width, overlay.height);
    return {
        minX: Math.min(tl.x, br.x), maxX: Math.max(tl.x, br.x),
        minY: Math.min(tl.y, br.y), maxY: Math.max(tl.y, br.y),
    };
}

// ─── deck.gl initialisation ───────────────────────────────────────────────────
const deckgl = new Deck({
    parent: deckContainer,
    views: new OrthographicView({ id: 'ortho', flipY: false }),
    initialViewState: viewState,
    controller: false,   // we handle pan/zoom ourselves for consistency
    onViewStateChange: () => {},
    useDevicePixels: true,
    _pickable: false,
    layers: [],
    parameters: { clearColor: [0, 0, 0, 0] },   // transparent — morph-canvas shows through
});

function updateDeckLayers() {
    const scale    = currentScale();
    const usePolys = localBdryFile && localBdryFile !== '__unavailable__' && polyData.length > 0 && scale >= POLY_SCALE_THRESHOLD;

    const layers = [];

    if (!usePolys) {
        // ── Dot mode: ScatterplotLayer ────────────────────────────────────────
        // Use radiusMinPixels/radiusMaxPixels so dots are always a sensible
        // screen size regardless of zoom. getRadius is in world units (µm);
        // radiusMinPixels/radiusMaxPixels clamp it on screen.
        layers.push(new ScatterplotLayer({
            id: 'cells-all',
            data: dotData,
            getPosition: d => [d.x, d.y],
            getRadius: 5,            // 5 µm world radius — only visible when zoomed in
            radiusMinPixels: 1.5,    // never smaller than 1.5px (readable at overview)
            radiusMaxPixels: 8,      // never larger than 8px (no overlap blobs)
            getFillColor: d => {
                if (clusterCellColours?.has(d.cell_id)) return clusterCellColours.get(d.cell_id);
                if (SELECTED_SET.size === 0) return [20, 220, 185, 160];
                if (SELECTED_SET.has(d.cell_id)) return [0, 0, 0, 0];
                return [20, 220, 185, 50];
            },
            radiusUnits: 'common',
            stroked: false,
            updateTriggers: { getFillColor: [SELECTED_SET.size, cellColours, clusterCellColours] },
        }));

        if (SELECTED_SET.size > 0) {
            layers.push(new ScatterplotLayer({
                id: 'cells-selected',
                data: selectedCells,
                getPosition: d => [d.x, d.y],
                getRadius: 7,
                radiusMinPixels: 3,
                radiusMaxPixels: 12,
                getFillColor: d => {
                    if (cellColours?.has(d.cell_id)) return cssToRgba(cellColours.get(d.cell_id), 80);
                    return [100, 140, 200, 30];   // muted blue — won't be confused with expression
                },
                getLineColor: d => {
                    if (cellColours?.has(d.cell_id)) return cssToRgba(cellColours.get(d.cell_id), 220);
                    return [100, 140, 200, 160];  // soft blue border
                },
                radiusUnits: 'common',
                stroked: true,
                lineWidthMinPixels: 1.5,
                updateTriggers: { getFillColor: [cellColours], getLineColor: [cellColours] },
            }));
        }

    } else {
        // ── Polygon mode: PolygonLayer ────────────────────────────────────────
        layers.push(new PolygonLayer({
            id: 'cell-polys',
            data: polyData,
            getPolygon: d => d.polygon,
            getFillColor: d => {
                if (clusterCellColours?.has(d.cellId)) return clusterCellColours.get(d.cellId);
                if (SELECTED_SET.has(d.cellId)) {
                    if (cellColours?.has(d.cellId)) return cssToRgba(cellColours.get(d.cellId), 60);
                    return [100, 140, 200, 25];   // muted blue fill
                }
                if (SELECTED_SET.size > 0) return [20, 220, 185, 25];
                return [20, 220, 185, 55];
            },
            getLineColor: d => {
                if (clusterCellColours?.has(d.cellId)) { const c=clusterCellColours.get(d.cellId); return [c[0],c[1],c[2],200]; }
                if (SELECTED_SET.has(d.cellId)) {
                    if (cellColours?.has(d.cellId)) return cssToRgba(cellColours.get(d.cellId), 255);
                    return [100, 140, 200, 180];  // soft blue border
                }
                return [20, 220, 185, 130];
            },
            lineWidthUnits: 'pixels',
            getLineWidth: d => SELECTED_SET.has(d.cellId) ? 1.5 : 0.8,
            filled: true, stroked: true,
            updateTriggers: {
                getFillColor: [SELECTED_SET.size, cellColours, clusterCellColours],
                getLineColor: [SELECTED_SET.size, cellColours, clusterCellColours],
                getLineWidth: [SELECTED_SET.size],
            },
        }));
    }

    deckgl.setProps({
        layers,
        viewState: { ...viewState, id: 'ortho' },
    });
    renderMorphCanvas();
}

// ─── Overlay canvas (2D) — selection shape, draw preview, magic lens ──────────
function resizeOverlay() {
    const wrap = deckContainer.parentElement;
    overlay.width      = wrap.clientWidth;
    overlay.height     = wrap.clientHeight;
    morphCanvas.width  = wrap.clientWidth;
    morphCanvas.height = wrap.clientHeight;
}

// ─── Morphology canvas rendering ──────────────────────────────────────────────
// Tiles are drawn directly on a Canvas2D underneath deck.gl.
// CSS filter (brightness/contrast) is applied only to this canvas.
function renderMorphCanvas() {
    const W = morphCanvas.width, H = morphCanvas.height;
    mctx.clearRect(0, 0, W, H);
    if (!morphologyOn || !tiffLoader) return;

    const bbox  = viewportBbox();
    const ready = tileCache.readyTiles(bbox);
    if (!ready.length) return;

    for (const t of ready) {
        const [left, bottom, right, top] = t.bounds;
        // bounds: left=xMin, bottom=yMin, right=xMax, top=yMax (no Y-flip)
        // dataToScreen handles Y-up → screen correctly: larger y → smaller screen y
        const tl = dataToScreen(left,  top);     // screen top-left
        const br = dataToScreen(right, bottom);  // screen bottom-right
        const sw = br.x - tl.x, sh = br.y - tl.y;
        if (sw <= 0 || sh <= 0) continue;
        mctx.drawImage(t.image, tl.x, tl.y, sw, sh);
    }
}

function renderOverlay() {
    const W = overlay.width, H = overlay.height;
    octx.clearRect(0, 0, W, H);
    if (selection) drawSelectionShape();
    if (isDrawingPoly && polyPoints.length) drawPolyPreview();
    if (isDrawingCircle && mouseScreen) drawCirclePreview();
    if (magicLensActive && lensPos && !isPanning) drawMagicLens();
}

function drawSelectionShape() {
    octx.save();
    octx.strokeStyle = 'rgba(100,140,200,0.75)';
    octx.fillStyle   = 'rgba(100,140,200,0.02)';
    octx.lineWidth   = 1.5;
    octx.setLineDash([5, 4]);
    if (selection.kind === 'circle') {
        const { x, y } = dataToScreen(selection.cx, selection.cy);
        octx.beginPath(); octx.arc(x, y, selection.radius * currentScale(), 0, Math.PI*2);
        octx.fill(); octx.stroke();
    } else {
        const pts = selection.points.map(p => dataToScreen(p.x, p.y));
        octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
        for (let i=1; i<pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
        octx.closePath(); octx.fill(); octx.stroke();
    }
    octx.setLineDash([]); octx.restore();
}

function drawPolyPreview() {
    const pts = polyPoints.map(p => dataToScreen(p.x, p.y));
    octx.save();
    octx.strokeStyle = 'rgba(108,79,214,0.75)'; octx.lineWidth = 1.5; octx.setLineDash([4,3]);
    octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
    for (let i=1; i<pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    if (mouseScreen) octx.lineTo(mouseScreen.x, mouseScreen.y);
    octx.stroke(); octx.setLineDash([]);
    octx.fillStyle = 'rgba(108,79,214,0.9)';
    for (const p of pts) { octx.beginPath(); octx.arc(p.x, p.y, 4, 0, Math.PI*2); octx.fill(); }
    octx.strokeStyle = '#fff'; octx.lineWidth = 1;
    octx.beginPath(); octx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI*2); octx.stroke();
    octx.restore();
}

function drawCirclePreview() {
    if (!mouseScreen) return;
    const ds = screenToData(circleStart.x, circleStart.y);
    const de = screenToData(mouseScreen.x, mouseScreen.y);
    const { x, y } = dataToScreen((ds.x+de.x)/2, (ds.y+de.y)/2);
    const pr = Math.hypot(mouseScreen.x-circleStart.x, mouseScreen.y-circleStart.y) / 2;
    octx.save();
    octx.strokeStyle = 'rgba(108,79,214,0.75)'; octx.fillStyle = 'rgba(108,79,214,0.07)';
    octx.lineWidth = 1.5; octx.setLineDash([5,4]);
    octx.beginPath(); octx.arc(x, y, pr, 0, Math.PI*2); octx.fill(); octx.stroke();
    octx.setLineDash([]); octx.restore();
}

function drawMagicLens() {
    const { sx, sy } = lensPos;
    const pr = parseFloat(radiusSlider.value) * currentScale();
    const W = overlay.width, H = overlay.height;

    octx.save();
    octx.beginPath(); octx.arc(sx, sy, pr, 0, Math.PI*2);
    octx.fillStyle = 'rgba(108,79,214,0.05)'; octx.fill();
    octx.strokeStyle = 'rgba(108,79,214,0.8)'; octx.lineWidth = 1.5; octx.stroke();
    octx.beginPath(); octx.arc(sx, sy, 3, 0, Math.PI*2);
    octx.fillStyle = 'rgba(108,79,214,0.9)'; octx.fill();
    octx.restore();

    if (!lensData) return;

    const PAD=12, LABEL_W=52, BAR_W=120, ROW_H=16;
    const genes = lensData.genes.slice(0, 8);
    const HUD_W = PAD + LABEL_W + BAR_W + PAD;
    const HUD_H = PAD*2 + 18 + genes.length * ROW_H;
    const gap = 10;
    let hx = sx + pr + gap;
    let hy = sy - HUD_H/2;
    if (hx + HUD_W > W-8) hx = sx - pr - gap - HUD_W;
    if (hy < 8) hy = 8;
    if (hy + HUD_H > H-8) hy = H - HUD_H - 8;

    octx.save();
    octx.shadowColor = 'rgba(0,0,0,0.4)'; octx.shadowBlur = 14; octx.shadowOffsetY = 3;
    octx.fillStyle = 'rgba(24,24,27,0.92)';
    roundRect(octx, hx, hy, HUD_W, HUD_H, 8); octx.fill();
    octx.shadowBlur = 0;
    octx.strokeStyle = 'rgba(108,79,214,0.5)'; octx.lineWidth = 1;
    roundRect(octx, hx, hy, HUD_W, HUD_H, 8); octx.stroke();

    octx.fillStyle = 'rgba(255,255,255,0.5)';
    octx.font = '500 10px Inter, system-ui';
    octx.fillText(`${lensData.cellCount} cells · ${(lensData.txCount||0).toLocaleString()} tx`, hx+PAD, hy+PAD+10);

    if (lensData.pending) {
        octx.fillStyle = 'rgba(108,79,214,0.6)';
        octx.font = '10px Inter';
        octx.fillText('loading expression…', hx+PAD, hy+PAD+28);
        octx.restore(); return;
    }

    const maxCount = genes[0]?.count || 1;
    genes.forEach(({ gene, count }, i) => {
        const ry = hy + PAD + 18 + i * ROW_H;
        const frac = count / maxCount;
        const t = 1 - i / Math.max(genes.length-1, 1);
        octx.fillStyle = 'rgba(255,255,255,0.7)';
        octx.font = '400 10px "JetBrains Mono",monospace';
        octx.fillText(gene.length>8 ? gene.slice(0,7)+'…' : gene, hx+PAD, ry+10);
        octx.fillStyle = 'rgba(255,255,255,0.07)';
        roundRect(octx, hx+PAD+LABEL_W, ry+2, BAR_W, ROW_H-4, 2); octx.fill();
        octx.fillStyle = viridisCSS(t);
        roundRect(octx, hx+PAD+LABEL_W, ry+2, Math.max(3, frac*BAR_W), ROW_H-4, 2); octx.fill();
    });
    octx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
}

// ─── Resize ───────────────────────────────────────────────────────────────────
function onResize() {
    resizeOverlay();
    deckgl.setProps({ width: deckContainer.clientWidth, height: deckContainer.clientHeight });
    renderOverlay();
    renderMorphCanvas();
}
window.addEventListener('resize', onResize);

// ─── View helpers ─────────────────────────────────────────────────────────────
function fitToData() {
    if (!dataExtent) return;
    const { minX, maxX, minY, maxY } = dataExtent;
    const W = deckContainer.clientWidth, H = deckContainer.clientHeight;
    const zoomX = Math.log2(W  / (maxX - minX));
    const zoomY = Math.log2(H  / (maxY - minY));
    viewState = {
        ...viewState,
        target: [(minX+maxX)/2, (minY+maxY)/2, 0],
        zoom:   Math.min(zoomX, zoomY) - 0.1,
    };
    deckgl.setProps({ viewState: { ...viewState, id: 'ortho' } });
}

function scheduleViewportFetch() {
    clearTimeout(vpDebounce);
    vpDebounce = setTimeout(fetchViewportCells, 120);
    if (currentScale() >= POLY_SCALE_THRESHOLD) {
        ensureBdryLoaded();
        clearTimeout(polyDebounce);
        polyDebounce = setTimeout(fetchViewportPolygons, 200);
    } else if (polyData.length) {
        polyData = [];
        updateDeckLayers();
    }
    if (morphologyOn && tiffLoader) scheduleMorphFetch();
}

function scheduleMorphFetch() {
    clearTimeout(morphDebounce);
    morphDebounce = setTimeout(fetchMorphTiles, 180);
}

function fetchMorphTiles() {
    if (!morphologyOn || !tiffLoader) return;
    const bbox  = viewportBbox();
    const scale = currentScale();
    const level = tiffLoader.bestLevel(scale);

    const meta  = tiffLoader._meta.get(level);
    const totalTilesAtLevel = meta ? meta.nCols * meta.nRows : 999;
    // At coarse levels (few tiles total) fetch everything; at fine levels cap inflight
    const MAX_INFLIGHT = totalTilesAtLevel <= 32 ? totalTilesAtLevel : 8;

    const tiles = tiffLoader.tilesForBbox(level, bbox);
    let inflight = 0;

    for (const { col, row } of tiles) {
        const entry = tileCache.get(level, col, row);
        if (entry?.state === 'ready' || entry?.state === 'error') continue;
        if (entry?.state === 'loading') { inflight++; continue; }
        if (inflight >= MAX_INFLIGHT) continue;
        inflight++;
        tileCache.request(tiffLoader, level, col, row, () => {
            renderMorphCanvas();
            updateDeckLayers();
        });
    }

    // Pre-fetch coarser level for instant fallback when zooming in
    if (level > 0) {
        const coarser = level - 1;
        const coarseMeta = tiffLoader._meta.get(coarser);
        const coarseTotal = coarseMeta ? coarseMeta.nCols * coarseMeta.nRows : 999;
        const coarseMax = coarseTotal <= 32 ? coarseTotal : 8;
        const coarseTiles = tiffLoader.tilesForBbox(coarser, bbox);
        for (const { col, row } of coarseTiles) {
            const entry = tileCache.get(coarser, col, row);
            if (entry?.state === 'ready' || entry?.state === 'error' || entry?.state === 'loading') continue;
            if (inflight >= MAX_INFLIGHT + coarseMax) break;
            inflight++;
            tileCache.request(tiffLoader, coarser, col, row, () => {
                renderMorphCanvas();
                updateDeckLayers();
            });
        }
    }

    updateDeckLayers();
}

// ─── Viewport cell fetch (dot mode) ──────────────────────────────────────────
const MAX_DOTS = 80_000;

async function fetchViewportCells() {
    if (!conn || !dataExtent || !localCellsFile) return;
    let bbox = viewportBbox();
    // If bbox is degenerate (overlay not sized yet or view not set), fall back to full extent
    if (bbox.maxX - bbox.minX < 1 || bbox.maxY - bbox.minY < 1) {
        bbox = { minX: dataExtent.minX, maxX: dataExtent.maxX,
                 minY: dataExtent.minY, maxY: dataExtent.maxY };
    }
    const frac = Math.min(1, ((bbox.maxX-bbox.minX)*(bbox.maxY-bbox.minY)) /
                             ((dataExtent.maxX-dataExtent.minX)*(dataExtent.maxY-dataExtent.minY)));
    const sample = Math.max(1, Math.ceil(frac * totalCells / MAX_DOTS));
    const sc = sample > 1 ? `AND file_row_number % ${sample} = 0` : '';
    try {
        const stmt = await conn.prepare(`
            SELECT cell_id, x_centroid AS x, y_centroid AS y
            FROM   read_parquet( ? )
            WHERE  x_centroid BETWEEN ? AND ?
              AND  y_centroid BETWEEN ? AND ?
              ${sc}
            LIMIT  ${MAX_DOTS}
        `);
        const res = await stmt.query(localCellsFile, bbox.minX, bbox.maxX, bbox.minY, bbox.maxY);
        dotData = res.toArray().map(r => ({ cell_id: r.cell_id, x: Number(r.x), y: Number(r.y) }));
        updateDeckLayers();
    } catch(e) { console.warn('dot fetch:', e); }
}

// ─── Boundary loading & polygon fetch ────────────────────────────────────────
async function ensureBdryLoaded() {
    if (localBdryFile || bdryLoading) return;
    bdryLoading = true;
    const baseUrl = datasetInput.value.trim().replace(/\/$/, '');
    log('Loading cell_boundaries.parquet…', 'run');
    try {
        const resp = await fetch(`${baseUrl}/cell_boundaries.parquet`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const total = parseInt(resp.headers.get('content-length')||'0', 10);
        const reader = resp.body.getReader();
        const chunks = []; let loaded = 0;
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            chunks.push(value); loaded += value.byteLength;
            if (loaded%(4*1024*1024) < value.byteLength) await new Promise(r=>setTimeout(r,0));
        }
        const buf = new Uint8Array(chunks.reduce((s,c) => s+c.byteLength, 0));
        let off=0; for (const c of chunks) { buf.set(c,off); off+=c.byteLength; }
        await db.registerFileBuffer('cell_boundaries.parquet', buf);
        localBdryFile = 'cell_boundaries.parquet';
        log(`Boundaries loaded (${(loaded/1e6).toFixed(1)} MB)`, 'ok');
        if (currentScale() >= POLY_SCALE_THRESHOLD) fetchViewportPolygons();
    } catch(e) {
        log(`Boundaries unavailable: ${e.message}`, 'err');
        localBdryFile = '__unavailable__';
    } finally { bdryLoading = false; }
}

async function fetchViewportPolygons() {
    if (!conn || !localBdryFile || localBdryFile==='__unavailable__' || !localCellsFile) return;
    const ver  = ++polyVersion;
    const bbox = viewportBbox();
    const m = (bbox.maxX-bbox.minX)*0.05;
    const x0=bbox.minX-m, x1=bbox.maxX+m, y0=bbox.minY-m, y1=bbox.maxY+m;
    try {
        // Bbox on both tables: centroid bbox picks the right cells,
        // vertex bbox pushes row-group skipping into cell_boundaries.parquet too
        const stmt = await conn.prepare(`
            SELECT  b.cell_id, b.vertex_x AS x, b.vertex_y AS y
            FROM    read_parquet( ? ) AS b
            WHERE   b.vertex_x BETWEEN ? AND ?
              AND   b.vertex_y BETWEEN ? AND ?
              AND   b.cell_id IN (
                        SELECT cell_id FROM read_parquet( ? )
                        WHERE  x_centroid BETWEEN ? AND ?
                          AND  y_centroid BETWEEN ? AND ?
                    )
            ORDER BY b.cell_id
        `);
        const res = await stmt.query(
            localBdryFile, x0, x1, y0, y1,
            localCellsFile, x0, x1, y0, y1
        );
        // Group vertices into polygon arrays for PolygonLayer
        const cells = new Map();   // cellId → [[x,y],…]
        for (const row of res.toArray()) {
            const id = row.cell_id;
            if (!cells.has(id)) cells.set(id, []);
            cells.get(id).push([Number(row.x), Number(row.y)]);
        }
        // Discard if a newer fetch has started or we've zoomed back out
        if (ver !== polyVersion) return;
        if (currentScale() < POLY_SCALE_THRESHOLD) return;
        polyData = [...cells.entries()]
            .filter(([,pts]) => pts.length >= 3)
            .map(([cellId, polygon]) => ({ cellId, polygon }));
        updateDeckLayers();
    } catch(e) { console.warn('poly fetch:', e); }
}

// ─── Mouse events on deck.gl canvas ──────────────────────────────────────────
// deck.gl owns its canvas; we intercept events via the container div
const interactEl = deckContainer;

interactEl.style.cursor = 'crosshair';

interactEl.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1 : -1;
    const newZoom = viewState.zoom + f * 0.15;
    const s0 = currentScale();
    const dx =  (e.offsetX - deckContainer.clientWidth/2)  / s0;
    const dy = -(e.offsetY - deckContainer.clientHeight/2) / s0;
    const s1 = Math.pow(2, newZoom);
    const tx = viewState.target[0] + dx - dx*(s0/s1);
    const ty = viewState.target[1] + dy - dy*(s0/s1);
    viewState = { ...viewState, zoom: newZoom, target: [tx, ty, 0] };
    deckgl.setProps({ viewState: { ...viewState, id: 'ortho' } });
    renderOverlay();
    renderMorphCanvas();
    scheduleViewportFetch();
}, { passive: false });

interactEl.addEventListener('mousedown', e => {
    if (e.shiftKey) {
        if (drawMode === 'circle') { isDrawingCircle=true; circleStart={x:e.offsetX,y:e.offsetY}; mouseScreen={x:e.offsetX,y:e.offsetY}; }
    } else {
        isPanning = true;
        interactEl.style.cursor = 'grabbing';
        panStart = { x: e.offsetX, y: e.offsetY };
        panViewState = { ...viewState };
    }
});

interactEl.addEventListener('mousemove', e => {
    mouseScreen = { x: e.offsetX, y: e.offsetY };

    if (isPanning) {
        const s = currentScale();
        const dx = (e.offsetX - panStart.x) / s;
        const dy = (e.offsetY - panStart.y) / s;
        viewState = {
            ...panViewState,
            target: [panViewState.target[0] - dx, panViewState.target[1] + dy, 0],
        };
        deckgl.setProps({ viewState: { ...viewState, id: 'ortho' } });
        renderMorphCanvas();
        scheduleViewportFetch();
    }
    renderOverlay();

    if (magicLensActive && !isPanning && !isDrawingCircle && !isDrawingPoly) {
        lensPos = { sx: e.offsetX, sy: e.offsetY };
        scheduleLensQuery();
    }
});

interactEl.addEventListener('mouseup', e => {
    interactEl.style.cursor = magicLensActive ? 'none' : 'crosshair';
    if (isPanning) { isPanning=false; return; }
    if (isDrawingCircle && e.shiftKey) {
        isDrawingCircle = false;
        const ds = screenToData(circleStart.x, circleStart.y);
        const de = screenToData(e.offsetX, e.offsetY);
        const dataR = Math.max(20, Math.hypot(e.offsetX-circleStart.x, e.offsetY-circleStart.y) / 2 / currentScale());
        radiusSlider.value = Math.min(Math.round(dataR), radiusSlider.max);
        radiusVal.textContent = radiusSlider.value;
        selection = { kind:'circle', cx:(ds.x+de.x)/2, cy:(ds.y+de.y)/2, radius:dataR };
        mouseScreen = null;
        commitSelection();
    }
});

interactEl.addEventListener('mouseleave', () => {
    isPanning = false; mouseScreen = null;
    lensPos = null; lensData = null;
    interactEl.style.cursor = 'crosshair';
    renderOverlay();
});

interactEl.addEventListener('click', e => {
    if (!e.shiftKey || drawMode!=='polygon') return;
    e.preventDefault();
    const pt = screenToData(e.offsetX, e.offsetY);
    if (!isDrawingPoly) { isDrawingPoly=true; polyPoints=[pt]; renderOverlay(); return; }
    const first = dataToScreen(polyPoints[0].x, polyPoints[0].y);
    if (Math.hypot(e.offsetX-first.x, e.offsetY-first.y) < 12 && polyPoints.length >= 3) { closePoly(); return; }
    polyPoints.push(pt); renderOverlay();
});

interactEl.addEventListener('dblclick', e => {
    if (!e.shiftKey || drawMode!=='polygon' || !isDrawingPoly) return;
    e.preventDefault(); if (polyPoints.length >= 3) closePoly();
});

function closePoly() {
    isDrawingPoly=false; selection={kind:'polygon',points:[...polyPoints]};
    polyPoints=[]; mouseScreen=null; commitSelection();
}
function commitSelection() { queryBtn.disabled=false; clearBtn.style.display=''; renderOverlay(); }

// ─── Magic Lens queries ───────────────────────────────────────────────────────
function scheduleLensQuery() {
    clearTimeout(lensDebounceFast); clearTimeout(lensDebounceGex);
    lensDebounceFast = setTimeout(runLensCellQuery, 200);
    lensDebounceGex  = setTimeout(runLensGexQuery,  700);
}

async function runLensCellQuery() {
    if (!conn || !localCellsFile || !lensPos) return;
    const ver = ++lensQueryVer;
    const { x:cx, y:cy } = screenToData(lensPos.sx, lensPos.sy);
    const r = parseFloat(radiusSlider.value);
    try {
        const stmt = await conn.prepare(`
            SELECT count(*) AS n, sum(transcript_counts) AS tx FROM read_parquet( ? )
            WHERE  x_centroid BETWEEN ? AND ?
              AND  y_centroid BETWEEN ? AND ?
              AND  (x_centroid-?)*(x_centroid-?) + (y_centroid-?)*(y_centroid-?) <= ?
        `);
        const res = await stmt.query(localCellsFile,
            cx-r, cx+r, cy-r, cy+r, cx, cx, cy, cy, r*r);
        if (ver !== lensQueryVer) return;
        const row0 = res.toArray()[0];
        lensData = { cellCount: Number(row0.n), txCount: Number(row0.tx||0), genes:[], pending: true };
        renderOverlay();
    } catch(e) { console.warn('lens cell:', e); }
}

async function runLensGexQuery() {
    if (!conn || !localCellsFile || !lensPos) return;
    const ver = ++lensQueryVer;
    const { x:cx, y:cy } = screenToData(lensPos.sx, lensPos.sy);
    const r = parseFloat(radiusSlider.value);
    const baseUrl = datasetInput.value.trim().replace(/\/$/, '');
    try {
        const stmt = await conn.prepare(`
            SELECT cell_id FROM read_parquet( ? )
            WHERE  x_centroid BETWEEN ? AND ?
              AND  y_centroid BETWEEN ? AND ?
              AND  (x_centroid-?)*(x_centroid-?) + (y_centroid-?)*(y_centroid-?) <= ?
        `);
        const res = await stmt.query(localCellsFile,
            cx-r, cx+r, cy-r, cy+r, cx, cx, cy, cy, r*r);
        if (ver !== lensQueryVer) return;
        const cellIds = res.toArray().map(r => r.cell_id);
        if (!cellIds.length) { lensData={cellCount:0,txCount:0,genes:[],pending:false}; renderOverlay(); return; }
        let genes=[];
        if (activeSource==='transcripts-parquet') {
            const gex = await gexFromTranscriptsParquet(conn, `${baseUrl}/transcripts.parquet`, {kind:'circle',cx,cy,radius:r}, activeScope, cellIds);
            if (ver!==lensQueryVer) return;
            genes = aggregateGex(gex.cells).slice(0,8);
        } else {
            const gex = await gexFromCellFeatureMatrixZarr(`${baseUrl}/cell_feature_matrix.zarr.zip`, cellIds);
            if (ver!==lensQueryVer) return;
            genes = aggregateGex(gex.cells).slice(0,8);
        }
        lensData = { cellCount: cellIds.length, txCount: lensData?.txCount ?? 0, genes, pending:false };
        renderOverlay();
    } catch(e) { console.warn('lens gex:', e); }
}

// ─── Magic Lens toggle ────────────────────────────────────────────────────────
magicLensBtn.addEventListener('click', () => {
    magicLensActive = !magicLensActive;
    magicLensBtn.classList.toggle('active', magicLensActive);
    interactEl.style.cursor = magicLensActive ? 'none' : 'crosshair';
    if (!magicLensActive) { lensPos=null; lensData=null; renderOverlay(); }
});

// ─── Draw mode UI ─────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); drawMode=btn.dataset.mode;
    circleControls.style.display = drawMode==='circle' ? '' : 'none';
    polygonHint.style.display    = drawMode==='polygon' ? '' : 'none';
    isDrawingCircle=false; isDrawingPoly=false; polyPoints=[]; mouseScreen=null; renderOverlay();
}));

radiusSlider.addEventListener('input', () => {
    radiusVal.textContent = radiusSlider.value;
    if (selection?.kind==='circle') { selection.radius=parseFloat(radiusSlider.value); renderOverlay(); }
});

// ─── Source / scope / tab / colour pickers ────────────────────────────────────
document.querySelectorAll('.source-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.source-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); activeSource=btn.dataset.source;
    document.getElementById('scope-row').classList.toggle('disabled', activeSource!=='transcripts-parquet');
}));
document.querySelectorAll('.scope-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.scope-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); activeScope=btn.dataset.scope;
}));
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); activeTab=btn.dataset.tab;
    heatmapWrap.style.display   = activeTab==='heatmap'   ? '' : 'none';
    matrixWrap.style.display    = activeTab==='matrix'    ? '' : 'none';
    highlightWrap.style.display = activeTab==='highlight' ? '' : 'none';
}));
document.querySelectorAll('.colour-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.colour-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); colourMode=btn.dataset.colour;
    highlightLegend.style.display = colourMode==='aggregate' ? '' : 'none';
}));

// ─── Clear selection ──────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
    selection=null; polyPoints=[]; isDrawingPoly=false; isDrawingCircle=false; mouseScreen=null;
    selectedCells=[]; SELECTED_SET.clear(); lastGexResult=null;
    cellColours=null; selectedGenes=[]; allGenesSorted=[];
    statCells.textContent='—'; statTx.textContent='—'; queryBtn.disabled=true; clearBtn.style.display='none';
    exportBtn.style.display='none'; highlightTabBtn.style.display='none';
    heatmapWrap.innerHTML=`<div class="empty-state"><div class="icon">🔬</div>Draw a selection on the map</div>`;
    matrixWrap.innerHTML=`<div class="empty-state">No data yet</div>`;
    updateDeckLayers(); renderOverlay();
});

// ─── Stream file with progress ────────────────────────────────────────────────
async function streamWithProgress(url, label) {
    progressWrap.style.display='block'; progressFill.style.width='0%';
    progressLabel.textContent=`${label} — connecting…`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const total = parseInt(resp.headers.get('content-length')||'0',10);
    const reader = resp.body.getReader();
    const chunks=[]; let loaded=0;
    while(true) {
        const {done,value}=await reader.read(); if(done) break;
        chunks.push(value); loaded+=value.byteLength;
        if(total){
            const pct=(loaded/total*100).toFixed(1);
            progressFill.style.width=`${pct}%`;
            progressLabel.textContent=`${label} — ${pct}% (${(loaded/1e6).toFixed(1)}/${(total/1e6).toFixed(1)} MB)`;
        } else { progressLabel.textContent=`${label} — ${(loaded/1e6).toFixed(1)} MB…`; }
        if(loaded%(4*1024*1024)<value.byteLength) await new Promise(r=>setTimeout(r,0));
    }
    progressLabel.textContent=`${label} — assembling…`; await new Promise(r=>setTimeout(r,0));
    const buf=new Uint8Array(chunks.reduce((s,c)=>s+c.byteLength,0));
    let off=0; for(const c of chunks){buf.set(c,off);off+=c.byteLength;}
    progressFill.style.width='100%';
    progressLabel.textContent=`${label} — registering…`; await new Promise(r=>setTimeout(r,0));
    return buf;
}

// ─── Load Dataset ─────────────────────────────────────────────────────────────
loadBtn.addEventListener('click', async () => {
    const baseUrl = datasetInput.value.trim().replace(/\/$/,'');
    if (!baseUrl) return;
    datasetLabel.textContent=baseUrl; loadBtn.disabled=true;
    try {
        const t0=Date.now();
        const buf=await streamWithProgress(`${baseUrl}/cells.parquet`,'cells.parquet');
        if (localCellsFile) { try{await db.dropFile(localCellsFile);}catch(_){} }
        if (localBdryFile && localBdryFile!=='__unavailable__') { try{await db.dropFile(localBdryFile);}catch(_){} }
        localCellsFile='cells.parquet'; localBdryFile=null; bdryLoading=false;
        await db.registerFileBuffer(localCellsFile, buf);
        progressLabel.textContent='Querying extent…'; await new Promise(r=>setTimeout(r,0));
        const ext=await conn.query(`SELECT count(*) AS n, sum(transcript_counts) AS tx, min(x_centroid) AS x0, max(x_centroid) AS x1, min(y_centroid) AS y0, max(y_centroid) AS y1 FROM read_parquet('${localCellsFile}')`);
        const row=arrowToJS(ext.toArray()[0]);
        totalCells=Number(row.n);
        dataExtent={minX:row.x0,maxX:row.x1,minY:row.y0,maxY:row.y1};
        statTotal.textContent=totalCells.toLocaleString();
        statTotalTx.textContent=Number(row.tx).toLocaleString();
        progressWrap.style.display='none';
        magicLensBtn.disabled=false;
        onResize();      // size overlay FIRST so viewportBbox() works
        fitToData();     // then set view state
        // Give deck.gl one frame to apply the view state before fetching
        await new Promise(r => requestAnimationFrame(r));
        log(`Loaded ${totalCells.toLocaleString()} cells in ${((Date.now()-t0)/1000).toFixed(2)}s`,'ok');
        log(`Extent x ${row.x0.toFixed(0)}–${row.x1.toFixed(0)}  y ${row.y0.toFixed(0)}–${row.y1.toFixed(0)} µm`,'ok');
        await fetchViewportCells();
        // Reset UI state synchronously first
        selection=null; selectedCells=[]; SELECTED_SET.clear(); polyData=[];
        isDrawingPoly=false; polyPoints=[];
        queryBtn.disabled=true; clearBtn.style.display='none';
        statCells.textContent='—'; statTx.textContent='—'; lastGexResult=null; cellColours=null;
        selectedGenes=[]; allGenesSorted=[];
        clusterCellColours=null; clusterGroupings=[]; cellIdByIndex=null;
        clusterSection.style.display='none'; datasetInfoSection.style.display='none';
        clearClusterBtn.style.display='none'; clusterLegend.innerHTML='';
        // Reset morphology
        morphologyOn=false; tiffLoader=null; tileCache.clear();
        morphologySection.style.display='none';
        morphologyToggleBtn.classList.remove('active');
        morphologyToggleBtn.textContent='Show Image';
        morphologyControls.style.display='none';
        brightnessSlider.value=100; contrastSlider.value=100;
        brightnessVal.textContent='1.0×'; contrastVal.textContent='1.0×';
        morphCanvas.style.filter='';
        mctx.clearRect(0, 0, morphCanvas.width, morphCanvas.height);
        deckContainer.style.opacity = 1;
        cellOpacity = 1.0;
        if (cellOpacitySlider) { cellOpacitySlider.value=100; cellOpacityVal.textContent='100%'; }
        applyImageFilter();
        exportBtn.style.display='none'; highlightTabBtn.style.display='none';
        heatmapWrap.innerHTML=`<div class="empty-state"><div class="icon">📍</div>Shift+drag (circle) or shift+click (polygon) to select</div>`;
        matrixWrap.innerHTML=`<div class="empty-state">No data yet</div>`;
        renderOverlay();
        // Fire background tasks after reset (non-blocking)
        buildCellIdIndex().catch(console.warn);
        loadExperimentMetadata(baseUrl);
        loadAnalysisZarr(baseUrl);
        loadMorphologyImage(baseUrl);
    } catch(err) {
        progressWrap.style.display='none';
        log(`Error: ${err.message}`,'err'); console.error(err);
    } finally { loadBtn.disabled=false; }
});

// ─── Selection → SQL ──────────────────────────────────────────────────────────
// IMPORTANT: We never use ST_DWithin as the primary filter — it's a function
// call that prevents DuckDB from using parquet row-group min/max statistics.
// Instead we use a tight bounding-box predicate (enables row-group skipping,
// ~10-50x faster) followed by an exact in-place test.
function selectionToSQL(sel, xCol, yCol) {
    if (sel.kind === 'circle') {
        const { cx, cy, radius: r } = sel;
        return {
            sql:    `${xCol} BETWEEN ? AND ?
                 AND ${yCol} BETWEEN ? AND ?
                 AND (${xCol}-?)*(${xCol}-?) + (${yCol}-?)*(${yCol}-?) <= ?`,
            params: [cx-r, cx+r, cy-r, cy+r, cx, cx, cy, cy, r*r],
        };
    }
    // Polygon: bbox pre-filter + ST_Within for exact test
    const xs = sel.points.map(p => p.x), ys = sel.points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const ring = sel.points.map(p => `${p.x} ${p.y}`).join(', ');
    const wkt  = `POLYGON((${ring}, ${sel.points[0].x} ${sel.points[0].y}))`;
    return {
        sql:    `${xCol} BETWEEN ? AND ?
             AND ${yCol} BETWEEN ? AND ?
             AND ST_Within(ST_Point(${xCol},${yCol}), ST_GeomFromText(?))`,
        params: [minX, maxX, minY, maxY, wkt],
    };
}

// ─── Query ────────────────────────────────────────────────────────────────────
queryBtn.addEventListener('click', async () => {
    if (!selection) return;
    const baseUrl=datasetInput.value.trim().replace(/\/$/,'');
    queryBtn.disabled=true; exportBtn.style.display='none';
    cellColours=null;
    log(`Querying ${selection.kind==='circle'?`circle r=${Math.round(selection.radius)}µm`:`polygon ${selection.points.length}pts`}`,'run');
    try {
        const t0=Date.now();
        const geo=selectionToSQL(selection,'x_centroid','y_centroid');
        const stmt=await conn.prepare(`
            SELECT cell_id, x_centroid AS x, y_centroid AS y,
                   file_row_number AS cell_index, nucleus_area, cell_area, transcript_counts
            FROM   read_parquet( ? )
            WHERE  ${geo.sql}
            ORDER BY file_row_number
        `);
        const res=await stmt.query(localCellsFile,...geo.params);
        selectedCells=res.toArray().map(arrowToJS);
        statCells.textContent=selectedCells.length.toLocaleString();
        const regionTx = selectedCells.reduce((s,c) => s + (c.transcript_counts||0), 0);
        statTx.textContent = regionTx.toLocaleString();
        SELECTED_SET.clear();
        for (const c of selectedCells) SELECTED_SET.add(c.cell_id);
        updateDeckLayers(); renderOverlay();
        log(`Found ${selectedCells.length.toLocaleString()} cells in ${((Date.now()-t0)/1000).toFixed(2)}s`,'ok');
        if (!selectedCells.length) {
            heatmapWrap.innerHTML=`<div class="empty-state"><div class="icon">🔍</div>No cells in selection</div>`;
            queryBtn.disabled=false; return;
        }
        const cellIds=selectedCells.map(c=>c.cell_id);
        log(`GEX [${activeSource}] scope=[${activeScope}]…`,'run');
        const t1=Date.now(); let gexResult;
        if (activeSource==='transcripts-parquet') {
            gexResult=await gexFromTranscriptsParquet(conn,`${baseUrl}/transcripts.parquet`,selection,activeScope,cellIds);
        } else {
            gexResult=await gexFromCellFeatureMatrixZarr(`${baseUrl}/cell_feature_matrix.zarr.zip`,cellIds);
        }
        lastGexResult=gexResult;
        log(`GEX done ${((Date.now()-t1)/1000).toFixed(2)}s — ${gexResult.geneNames.length} genes`,'ok');
        const aggregated=aggregateGex(gexResult.cells).slice(0,20);
        renderHeatmap(aggregated);
        renderMatrix(gexResult, aggregated.map(g=>g.gene));
        allGenesSorted=aggregateGex(gexResult.cells).map(g=>g.gene);
        selectedGenes=[];
        populateGeneList('');
        highlightTabBtn.style.display='';
        exportBtn.style.display='block';
    } catch(err) { log(`Error: ${err.message}`,'err'); console.error(err); }
    finally { queryBtn.disabled=false; }
});

// ─── Heatmap ──────────────────────────────────────────────────────────────────
function renderHeatmap(data) {
    if (!data.length) { heatmapWrap.innerHTML=`<div class="empty-state">No transcripts found</div>`; return; }
    const max=data[0].count;
    const col=f=>`rgb(${Math.round(f*180)},${Math.round(80+f*100)},${Math.round(180-f*140)})`;
    heatmapWrap.innerHTML=data.map(({gene,count})=>{
        const f=count/max;
        return `<div class="heatmap-bar" title="${gene}: ${count} transcripts">
          <div class="hm-gene">${gene}</div>
          <div class="hm-track"><div class="hm-fill" style="width:${(f*100).toFixed(1)}%;background:${col(f)};"></div></div>
          </div>`;
    }).join('');
}

// ─── Matrix ───────────────────────────────────────────────────────────────────
function renderMatrix(gexResult, topGenes) {
    const {cells}=gexResult;
    if (!cells.size||!topGenes.length){matrixWrap.innerHTML=`<div class="empty-state">No data</div>`;return;}
    const lookup=new Map();
    for(const[id,{geneNames,counts}]of cells){const m=new Map();for(let i=0;i<geneNames.length;i++)m.set(geneNames[i],counts[i]);lookup.set(id,m);}
    const header=`<tr><th>cell_id</th>${topGenes.map(g=>`<th class="gene-col">${g}</th>`).join('')}</tr>`;
    const rows=[...cells.keys()].map(id=>{
        const m=lookup.get(id)??new Map(),short=id.length>14?id.slice(0,13)+'…':id;
        return `<tr><td class="cell-col" title="${id}">${short}</td>${topGenes.map(g=>{const c=m.get(g)??0;return `<td class="count-cell${c?' nonzero':''}">${c||''}</td>`;}).join('')}</tr>`;
    }).join('');
    matrixWrap.innerHTML=`<table class="matrix-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

// ─── Gene picker ──────────────────────────────────────────────────────────────
function geneColour(gene) {
    if (geneCustomColours.has(gene)) return geneCustomColours.get(gene);
    return PALETTE[allGenesSorted.indexOf(gene) % PALETTE.length];
}
function setGeneColour(gene, hex) { geneCustomColours.set(gene,hex); populateGeneList(geneSearch.value); updateDeckLayers(); }

function populateGeneList(filter) {
    const f=filter.toLowerCase();
    const genes=allGenesSorted.filter(g=>!f||g.toLowerCase().includes(f)).slice(0,200);
    geneListEl.innerHTML=genes.map(g=>{
        const sel=selectedGenes.includes(g), col=geneColour(g);
        const agg=lastGexResult?[...lastGexResult.cells.values()].reduce((s,{geneNames,counts})=>{const i=geneNames.indexOf(g);return s+(i>=0?counts[i]:0);},0):0;
        return `<div class="gene-row${sel?' selected':''}" data-gene="${g}">
          <input type="color" class="gr-swatch" value="${col}" data-gene="${g}" />
          <div class="gr-name">${g}</div><div class="gr-count">${agg||''}</div></div>`;
    }).join('');
    geneListEl.querySelectorAll('.gene-row').forEach(row=>{
        row.addEventListener('click',e=>{if(e.target.classList.contains('gr-swatch'))return;toggleGene(row.dataset.gene);});
    });
    geneListEl.querySelectorAll('.gr-swatch').forEach(sw=>{
        sw.addEventListener('input', e=>{e.stopPropagation();setGeneColour(sw.dataset.gene,sw.value);});
        sw.addEventListener('change',e=>{e.stopPropagation();setGeneColour(sw.dataset.gene,sw.value);});
    });
    renderChips(); applyHighlightBtn.disabled=selectedGenes.length===0;
}

function renderChips() {
    geneChips.innerHTML=selectedGenes.map(g=>{
        const col=geneColour(g);
        return `<div class="gene-chip" data-gene="${g}" style="background:${col}22;border-color:${col};color:${col};">
          <input type="color" class="chip-swatch" value="${col}" data-gene="${g}" />
          ${g}<span class="chip-x">×</span></div>`;
    }).join('');
    geneChips.querySelectorAll('.gene-chip').forEach(chip=>{
        chip.addEventListener('click',e=>{if(e.target.classList.contains('chip-swatch')||e.target.classList.contains('chip-x'))return;toggleGene(chip.dataset.gene);});
        chip.querySelector('.chip-x').addEventListener('click',e=>{e.stopPropagation();toggleGene(chip.dataset.gene);});
    });
    geneChips.querySelectorAll('.chip-swatch').forEach(sw=>{
        sw.addEventListener('input', e=>{e.stopPropagation();setGeneColour(sw.dataset.gene,sw.value);});
        sw.addEventListener('change',e=>{e.stopPropagation();setGeneColour(sw.dataset.gene,sw.value);});
    });
}

function toggleGene(gene) {
    const idx=selectedGenes.indexOf(gene);
    if(idx>=0)selectedGenes.splice(idx,1);else selectedGenes.push(gene);
    populateGeneList(geneSearch.value);
}
geneSearch.addEventListener('input',()=>populateGeneList(geneSearch.value));

// ─── Apply / clear highlight ──────────────────────────────────────────────────
applyHighlightBtn.addEventListener('click',()=>{
    if(!lastGexResult||!selectedGenes.length) return;
    const {cells}=lastGexResult;
    if(colourMode==='palette'){
        cellColours=new Map();
        for(const[cellId,{geneNames,counts}]of cells){
            let best=null,bestC=0;
            for(let i=0;i<geneNames.length;i++) if(selectedGenes.includes(geneNames[i])&&counts[i]>bestC){bestC=counts[i];best=geneNames[i];}
            if(best) cellColours.set(cellId, geneColour(best)+'cc');
        }
    } else {
        const totals=new Map();
        for(const[cellId,{geneNames,counts}]of cells){
            let sum=0; for(let i=0;i<geneNames.length;i++) if(selectedGenes.includes(geneNames[i])) sum+=counts[i];
            if(sum>0) totals.set(cellId,sum);
        }
        const maxVal=Math.max(...totals.values(),1);
        cellColours=new Map();
        for(const[cellId,sum]of totals) cellColours.set(cellId,`rgb(${viridis(sum/maxVal).join(',')})`);
        legendGradient.style.background=`linear-gradient(90deg,${viridisCSS(0)},${viridisCSS(.5)},${viridisCSS(1)})`;
        legendMax.textContent=maxVal; highlightLegend.style.display='';
    }
    clearHighlightBtn.style.display='';
    log(`Highlighted ${cellColours.size} cells — ${selectedGenes.length} gene(s) [${colourMode}]`,'ok');
    updateDeckLayers();
});

clearHighlightBtn.addEventListener('click',()=>{
    cellColours=null; clearHighlightBtn.style.display='none';
    highlightLegend.style.display='none'; updateDeckLayers();
});

// ─── CSV Export ───────────────────────────────────────────────────────────────
exportBtn.addEventListener('click',()=>{
    if(!lastGexResult)return;
    const{geneNames,cells}=lastGexResult;
    const gl=[...geneNames].sort();
    const rows=[];
    for(const[id,{geneNames:gns,counts}]of cells){const m=new Map();for(let i=0;i<gns.length;i++)m.set(gns[i],counts[i]);rows.push([id,...gl.map(g=>m.get(g)??0)].join(','));}
    const blob=new Blob([['cell_id,'+gl.join(','),...rows].join('\n')],{type:'text/csv'});
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:'xenium_spotter_gex.csv'});
    a.click();URL.revokeObjectURL(a.href);
    log(`Exported ${cells.size} cells × ${gl.length} genes`,'ok');
});

// ─── Experiment metadata & cluster loading ────────────────────────────────────
const datasetInfoSection  = document.getElementById('dataset-info-section');
const datasetInfoContent  = document.getElementById('dataset-info-content');
const clusterSection      = document.getElementById('cluster-section');
const clusterMethodSelect = document.getElementById('cluster-method-select');
const applyClusterBtn     = document.getElementById('applyClusterBtn');
const clearClusterBtn     = document.getElementById('clearClusterBtn');
const clusterLegend       = document.getElementById('cluster-legend');

// 20-colour qualitative palette for clusters (ColorBrewer-inspired, dark-bg friendly)
const CLUSTER_PALETTE = [
    [228,26,28],[55,126,184],[77,175,74],[152,78,163],[255,127,0],
    [255,255,51],[166,86,40],[247,129,191],[153,153,153],[23,190,207],
    [31,119,180],[255,127,14],[44,160,44],[214,39,40],[148,103,189],
    [140,86,75],[227,119,194],[188,189,34],[23,190,207],[174,199,232],
];

async function loadExperimentMetadata(baseUrl) {
    try {
        const resp = await fetch(`${baseUrl}/experiment.xenium`);
        if (!resp.ok) return;
        const meta = await resp.json();
        const p = meta.payload ?? meta;
        const lines = [];
        if (p.panel?.name)      lines.push(`<b>Panel:</b> ${p.panel.name}`);
        if (p.chemistry)        lines.push(`<b>Chemistry:</b> ${p.chemistry}`);
        if (p.panel?.targets !== undefined) lines.push(`<b>Targets:</b> ${typeof p.panel.targets === 'number' ? p.panel.targets : Object.keys(p.panel.targets ?? {}).length}`);
        if (lines.length) {
            datasetInfoContent.innerHTML = lines.join('<br>');
            datasetInfoSection.style.display = '';
        }
    } catch(_) {}
}

async function loadAnalysisZarr(baseUrl) {
    try {
        const store = ZipFileStore.fromUrl(`${baseUrl}/analysis.zarr.zip`);
        const root  = await zarr.open(store);
        const cellGroupsGrp = await zarr.open(root.resolve('cell_groups'));
        const attrs = cellGroupsGrp.attrs ?? {};
        const names  = attrs.grouping_names  ?? [];
        const gNames = attrs.group_names     ?? [];   // list of lists
        const nGroupings = attrs.number_groupings ?? names.length;

        clusterGroupings = [];
        for (let g = 0; g < nGroupings; g++) {
            const indptrArr  = await zarr.open(cellGroupsGrp.resolve(`${g}/indptr`),  { kind: 'array' });
            const indicesArr = await zarr.open(cellGroupsGrp.resolve(`${g}/indices`), { kind: 'array' });
            const indptr  = (await zarr.get(indptrArr,  [null])).data;
            const indices = (await zarr.get(indicesArr, [null])).data;
            const nClusters = indptr.length - 1;
            const groups = [];
            for (let c = 0; c < nClusters; c++) {
                const start = Number(indptr[c]), end = Number(indptr[c+1]);
                const cellIndices = Array.from(indices.subarray(start, end)).map(Number);
                groups.push({ name: gNames[g]?.[c] ?? `Cluster ${c+1}`, cellIndices });
            }
            clusterGroupings.push({ name: names[g] ?? `Clustering ${g}`, groups });
        }

        if (!clusterGroupings.length) return;

        // Populate select
        clusterMethodSelect.innerHTML = clusterGroupings
            .map((m,i) => `<option value="${i}">${m.name.replace('gene_expression_','').replace(/_/g,' ')}</option>`)
            .join('');
        clusterSection.style.display = '';
        log(`Loaded ${nGroupings} cluster method(s) from analysis.zarr.zip`, 'ok');

    } catch(e) { console.warn('analysis.zarr load:', e); }
}

// We need cell_id lookup to map cluster cell indices → cell_id strings
// The analysis.zarr indices correspond to the row order in cells.parquet (file_row_number)
let cellIdByIndex = null;   // Float32Array → string[] built once after cells.parquet loads

async function buildCellIdIndex() {
    if (!conn || !localCellsFile) return;
    // Rows in cells.parquet are in stable file_row_number order.
    // array index i → cell_id for cluster index mapping.
    const res = await conn.query(
        `SELECT cell_id FROM read_parquet('${localCellsFile}') ORDER BY file_row_number`
    );
    cellIdByIndex = res.toArray().map(r => r.cell_id);
    log(`Cell index built (${cellIdByIndex.length.toLocaleString()} cells)`, 'ok');
}

applyClusterBtn.addEventListener('click', () => {
    if (!clusterGroupings.length || !cellIdByIndex) return;
    const method = clusterGroupings[parseInt(clusterMethodSelect.value)];
    if (!method) return;

    clusterCellColours = new Map();
    const legendItems = [];

    method.groups.forEach((grp, gi) => {
        const [r,g,b] = CLUSTER_PALETTE[gi % CLUSTER_PALETTE.length];
        const colour  = [r, g, b, 200];
        for (const idx of grp.cellIndices) {
            const id = cellIdByIndex[idx];
            if (id) clusterCellColours.set(id, colour);
        }
        legendItems.push(`<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-2);">
            <span style="width:10px;height:10px;border-radius:50%;background:rgb(${r},${g},${b});flex-shrink:0;"></span>
            ${grp.name}
        </span>`);
    });

    clusterLegend.innerHTML = legendItems.join('');
    clearClusterBtn.style.display = '';
    log(`Cluster colours applied: ${method.groups.length} clusters`, 'ok');
    updateDeckLayers();
});

clearClusterBtn.addEventListener('click', () => {
    clusterCellColours = null;
    clearClusterBtn.style.display = 'none';
    clusterLegend.innerHTML = '';
    updateDeckLayers();
});

// ─── Morphology image loading & controls ─────────────────────────────────────

async function loadMorphologyImage(baseUrl) {
    // Only probe file existence here — don't open the TIFF yet.
    // openTiff() is deferred to the first "Show Image" click.
    const candidates = [
        `${baseUrl}/morphology_focus/morphology_focus_0000.ome.tif`,
        `${baseUrl}/morphology_focus/morphology_focus_0000.ome.tiff`,
        `${baseUrl}/morphology.ome.tif`,
    ];
    for (const url of candidates) {
        try {
            const probe = await fetch(url, { method: 'HEAD' });
            if (!probe.ok) continue;
            // Store the confirmed URL for use on first toggle
            morphologySection.style.display = '';
            morphologyToggleBtn.dataset.tiffUrl = url;
            log(`Morphology image found`, 'ok');
            return;
        } catch (_) {}
    }
}

morphologyToggleBtn.addEventListener('click', async () => {
    // First click: open the TIFF (fetches IFD 0 only — one small range request)
    if (!tiffLoader) {
        const url = morphologyToggleBtn.dataset.tiffUrl;
        if (!url) return;
        morphologyToggleBtn.disabled = true;
        morphologyToggleBtn.textContent = 'Opening…';
        try {
            morphologyToggleBtn.textContent = 'Indexing…';
            tiffLoader = await openTiff(url);
            const slide = `${tiffLoader.slideW_µm.toFixed(0)}×${tiffLoader.slideH_µm.toFixed(0)}`;
            const cells = dataExtent ? `cells x:${dataExtent.minX.toFixed(0)}–${dataExtent.maxX.toFixed(0)} y:${dataExtent.minY.toFixed(0)}–${dataExtent.maxY.toFixed(0)}` : 'no extent';
            log(`Morphology: ${tiffLoader.numLevels} levels · slide ${slide} µm · ${cells}`, 'ok');
            console.debug(`[morph] slide=${slide} µm  ${cells}`);
        } catch(e) {
            log(`Morphology open failed: ${e.message}`, 'err');
            morphologyToggleBtn.disabled = false;
            morphologyToggleBtn.textContent = 'Show Image';
            return;
        }
        morphologyToggleBtn.disabled = false;
    }

    morphologyOn = !morphologyOn;
    morphologyToggleBtn.classList.toggle('active', morphologyOn);
    morphologyToggleBtn.textContent = morphologyOn ? 'Hide Image' : 'Show Image';
    morphologyControls.style.display = morphologyOn ? '' : 'none';

    if (morphologyOn) {
        // Pre-warm WASM decoder in background while scheduling first tiles
        import('./j2k-decoder.js').then(m => m.warmDecoder?.()).catch(() => {});
        // Eagerly fetch all tiles at the 2 coarsest levels for full overview coverage
        const n = tiffLoader.numLevels;
        for (let lvl = n - 1; lvl >= Math.max(0, n - 2); lvl--) {
            const meta = tiffLoader._meta.get(lvl);
            if (!meta) continue;
            for (let row = 0; row < meta.nRows; row++)
                for (let col = 0; col < meta.nCols; col++)
                    tileCache.request(tiffLoader, lvl, col, row, () => {
                        renderMorphCanvas(); updateDeckLayers();
                    });
        }
        scheduleMorphFetch();
    } else {
        updateDeckLayers();
    }
});

brightnessSlider.addEventListener('input', () => {
    const v = parseInt(brightnessSlider.value) / 100;
    brightnessVal.textContent = `${v.toFixed(1)}×`;
    tileCache.brightness = v;
    // Brightness/contrast are applied via CSS filter on the canvas — simpler than
    // re-decoding all tiles. Apply to deck-container directly.
    applyImageFilter();
});

contrastSlider.addEventListener('input', () => {
    const v = parseInt(contrastSlider.value) / 100;
    contrastVal.textContent = `${v.toFixed(1)}×`;
    tileCache.contrast = v;
    applyImageFilter();
});

cellOpacitySlider.addEventListener('input', () => {
    cellOpacity = parseInt(cellOpacitySlider.value) / 100;
    cellOpacityVal.textContent = `${Math.round(cellOpacity * 100)}%`;
    // Apply as CSS opacity to the deck.gl container
    deckContainer.style.opacity = cellOpacity;
});

function applyImageFilter() {
    const b = tileCache.brightness ?? 1;
    const c = tileCache.contrast   ?? 1;
    morphCanvas.style.filter = morphologyOn
        ? `brightness(${b}) contrast(${c})`
        : '';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
try {
    log('Initialising DuckDB-WASM…','run');
    const inst=await getDuckDb();
    conn=inst.conn; db=inst.db;
    dbStatus.textContent='READY'; dbStatus.className='';
    log('DuckDB ready','ok'); loadBtn.disabled=false;
    document.getElementById('scope-row').classList.add('disabled');
    onResize();
} catch(err) {
    dbStatus.textContent='ERROR'; dbStatus.className='error';
    log(`DuckDB init failed: ${err.message}`,'err'); console.error(err);
}
