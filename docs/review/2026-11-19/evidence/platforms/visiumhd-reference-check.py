# Independent oracle checks against the public Visium HD reference run, using
# small Range reads (h5py over fsspec HTTP; pyarrow on the 3.3 MB 16 um positions
# file; one barcode_mappings row group). No production code is used.
# Run: uv run --no-project --with h5py --with fsspec --with aiohttp --with requests \
#        --with pyarrow --with numpy python visiumhd-reference-check.py
import fsspec, h5py, json, io, re, gzip
import numpy as np, pyarrow.parquet as pq

B = 'https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f'
fs = fsspec.filesystem('http')
def openr(p, bs=256 * 1024):
    return fs.open(B + '/' + p, block_size=bs, cache_type='blockcache')

print('== A. 16 um tissue_positions.parquet: barcode digits vs array_row/array_col')
t = pq.read_table(io.BytesIO(fs.cat(B + '/binned_outputs/square_016um/spatial/tissue_positions.parquet'))).to_pandas()
print('columns', list(t.columns), 'rows', len(t), 'in_tissue', int(t.in_tissue.sum()))
m = t.barcode.str.extract(r'^s_(\d{3})um_(\d+)_(\d+)-1$').astype(int)
print('first-number == array_row for all:', bool((m[1] == t.array_row).all()),
      '| second-number == array_col for all:', bool((m[2] == t.array_col).all()))
print('array_row range', t.array_row.min(), t.array_row.max(), 'array_col range', t.array_col.min(), t.array_col.max())
asym = t[(t.in_tissue == 1) & (t.array_row != t.array_col)].iloc[0]
print('asymmetric example', asym.barcode, 'row', asym.array_row, 'col', asym.array_col,
      'pxl_row', asym.pxl_row_in_fullres, 'pxl_col', asym.pxl_col_in_fullres)

print('== B. feature_slice.h5 spot transform reproduces 16 um centres (nesting = floor(2um/8))')
with openr('feature_slice.h5') as f:
    h = h5py.File(f, 'r')
    md = json.loads(h.attrs['metadata_json'])
    T = np.array(md['transform_matrices']['spot_colrow_to_microscope_colrow'])
    print('nrows', md['nrows'], 'ncols', md['ncols'], 'spot_pitch', md['spot_pitch'])
    tin = t[t.in_tissue == 1]
    def project(colrow):
        v = T @ np.vstack([colrow[:, 0], colrow[:, 1], np.ones(len(colrow))])
        return v[0] / v[2], v[1] / v[2]  # (fullres col, fullres row)
    # centre of 16 um bin (r, c) is the mean of 2 um spots 8r..8r+7 -> 8r + 3.5
    cr = np.column_stack([8 * tin.array_col + 3.5, 8 * tin.array_row + 3.5])
    pc, pr = project(cr)
    print('max |pred - pxl_col|', np.abs(pc - tin.pxl_col_in_fullres).max(),
          'max |pred - pxl_row|', np.abs(pr - tin.pxl_row_in_fullres).max())
    swapped = np.column_stack([8 * tin.array_row + 3.5, 8 * tin.array_col + 3.5])
    sc, sr = project(swapped)
    print('row/col swapped: max error px', max(np.abs(sc - tin.pxl_col_in_fullres).max(), np.abs(sr - tin.pxl_row_in_fullres).max()))

    print('== D. feature slice summed to 16 um vs 16 um filtered matrix')
    names = [n.decode() for n in h['features/name'][:]]
    gene = 'A2M'
    gi = names.index(gene)
    g = h['feature_slices'][str(gi)]
    rows, cols, data = g['row'][:], g['col'][:], g['data'][:]
    print(gene, 'feature index', gi, 'nnz 2um', len(data), 'row max', rows.max(), 'col max', cols.max())
    r16, c16 = rows // 8, cols // 8
    key = r16.astype(np.int64) * 10000 + c16
    uk, inv = np.unique(key, return_inverse=True)
    sums = np.bincount(inv, weights=data.astype(np.float64))
    fs16 = {f's_016um_{k // 10000:05d}_{k % 10000:05d}-1': s for k, s in zip(uk, sums)}
    in_tissue16 = set(tin.barcode)
    out = [b for b in fs16 if b not in in_tissue16]
    print('16 um bins with', gene, 'counts in feature slice:', len(fs16), '; of those not in tissue:', len(out),
          '; counts there:', float(sum(fs16[b] for b in out)))

with openr('binned_outputs/square_016um/filtered_feature_bc_matrix.h5') as f:
    h = h5py.File(f, 'r')
    mx = h['matrix']
    fnames = [n.decode() for n in mx['features/name'][:]]
    fgi = fnames.index(gene)
    bcs = [b.decode() for b in mx['barcodes'][:]]
    indptr = mx['indptr'][:]
    print('filtered 16 um barcodes', len(bcs), 'shape attr', mx['shape'][:])
    # compare a deterministic sample: the 40 in-tissue bins with most A2M per feature slice + 20 with zero
    ranked = sorted(((v, b) for b, v in fs16.items() if b in in_tissue16), reverse=True)[:40]
    zero = [b for b in sorted(in_tissue16) if b not in fs16][:20]
    pos = {b: i for i, b in enumerate(bcs)}
    mism = 0
    for v, b in ranked + [(0.0, z) for z in zero]:
        i = pos[b]
        idx = mx['indices'][indptr[i]:indptr[i + 1]]
        dat = mx['data'][indptr[i]:indptr[i + 1]]
        hit = dat[idx == fgi]
        mv = float(hit.sum()) if len(hit) else 0.0
        if mv != v:
            mism += 1
            print('MISMATCH', b, 'feature_slice', v, 'matrix', mv)
    print('compared', len(ranked) + len(zero), 'bins; mismatches', mism)
    print('example', ranked[0][1], 'feature slice', ranked[0][0])

print('== E. barcode_mappings.parquet: nesting and id formats (one row group)')
with openr('barcode_mappings.parquet', 1024 * 1024) as f:
    pf = pq.ParquetFile(f)
    print('schema', pf.schema_arrow)
    print('row groups', pf.num_row_groups, 'rows', pf.metadata.num_rows)
    rg = pf.read_row_group(500).to_pandas()
    def parse(s):
        x = s.str.extract(r'^s_(\d{3})um_(\d+)_(\d+)-1$').astype(int)
        return x[1], x[2]
    r2, c2 = parse(rg.square_002um); r8, c8 = parse(rg.square_008um); r16b, c16b = parse(rg.square_016um)
    print('8um == floor(2um/4):', bool(((r2 // 4) == r8).all() and ((c2 // 4) == c8).all()),
          '| 16um == floor(2um/8):', bool(((r2 // 8) == r16b).all() and ((c2 // 8) == c16b).all()))
    print('cell_id sample', rg.cell_id.dropna().unique()[:3], 'in_cell dtype', rg.in_cell.dtype, 'in_nucleus dtype', rg.in_nucleus.dtype)
    print('rows in_nucleus but not in_cell:', int((rg.in_nucleus & ~rg.in_cell).sum()),
          '| rows with cell_id but neither flag:', int((rg.cell_id.notna() & ~rg.in_cell & ~rg.in_nucleus).sum()))
    st = pf.metadata.row_group(500).column(1).statistics
    print('square_008um stats has min/max', st.has_min_max, st.min, st.max)

print('== F. segmentation GeoJSON head')
head = fs.cat_file(B + '/segmented_outputs/cell_segmentations.geojson', start=0, end=600)
print(head.decode(errors='replace'))
head = fs.cat_file(B + '/segmented_outputs/nucleus_segmentations.geojson', start=0, end=600)
print(head.decode(errors='replace'))

print('== G. clusters.csv head and scalefactors')
print(fs.cat_file(B + '/binned_outputs/square_016um/analysis/clustering/gene_expression_graphclust/clusters.csv', start=0, end=120).decode())
for s in ('002', '008', '016'):
    print(s, json.loads(fs.cat(B + f'/binned_outputs/square_{s}um/spatial/scalefactors_json.json')))
