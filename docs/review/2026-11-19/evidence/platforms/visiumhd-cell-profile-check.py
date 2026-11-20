# Independent check (no production code): what a segmented-cell profile sums
# at 2 um versus 16 um on the public reference, against Space Ranger's own
# segmented_outputs/filtered_feature_cell_matrix.h5; and whether graphclust
# cluster numbers line up across the 8 and 16 um tiers. Small Range reads only.
import fsspec, h5py, io, re
import numpy as np, pandas as pd, pyarrow.parquet as pq

B = 'https://mp33.cog.sanger.ac.uk/public/visiumhd/spaceranger401_count_50314_48d90238006ebffe73177a68c2b4f48f'
fs = fsspec.filesystem('http')
def openr(p, bs=256 * 1024):
    return fs.open(B + '/' + p, block_size=bs, cache_type='blockcache')

def rc(s):
    x = s.str.extract(r'^s_\d{3}um_(\d+)_(\d+)-1$').astype(int)
    return x[0].to_numpy(), x[1].to_numpy()

print('== 1. barcode_mappings window')
with openr('barcode_mappings.parquet', 1024 * 1024) as f:
    pf = pq.ParquetFile(f)
    df = pd.concat([pf.read_row_groups(list(range(480, 520))).to_pandas()])
r2, c2 = rc(df.square_002um)
df['r2'], df['c2'] = r2, c2
full_rows = [r for r, n in df.groupby('r2').size().items() if n == 3350]
lo, hi = min(full_rows), max(full_rows)
print('2 um rows fully loaded', lo, '..', hi)
cells = df[df.cell_id.notna() & df.in_cell]
span = cells.groupby('cell_id').agg(rmin=('r2', 'min'), rmax=('r2', 'max'), n=('r2', 'size'))
# parent 16 um rows must be entirely loaded too
ok = span[(span.rmin // 8 * 8 >= lo) & (span.rmax // 8 * 8 + 7 <= hi)]
cell = ok.sort_values('n').index[len(ok) // 2]  # median-size complete cell
S2 = cells[cells.cell_id == cell]
P16 = sorted(set(S2.square_016um))
print('cell', cell, 'in_cell 2 um bins', len(S2), '(%.0f um^2)' % (4 * len(S2)), '| mapped 16 um bins', len(P16), P16)
p16rc = {(int(m.group(1)), int(m.group(2))) for m in (re.match(r's_016um_(\d+)_(\d+)-1', b) for b in P16)}
inside = df[[((r // 8), (c // 8)) in p16rc for r, c in zip(df.r2, df.c2)]]
print('2 um bins inside those 16 um bins', len(inside), '| assigned to this cell', int((inside.cell_id == cell).sum()),
      '| assigned to other cells', int((inside.cell_id.notna() & (inside.cell_id != cell)).sum()),
      '| other cell ids', inside.cell_id.dropna().nunique() - 1)

print('== 2. Space Ranger cell matrix vs 16 um bin sum vs 2 um sum')
def column(path, barcode_list):
    with openr(path) as f:
        h = h5py.File(f, 'r'); mx = h['matrix']
        names = [n.decode() for n in mx['features/name'][:]]
        bcs = {b.decode(): i for i, b in enumerate(mx['barcodes'][:])}
        indptr = mx['indptr'][:]
        out = {}
        for b in barcode_list:
            i = bcs[b]
            idx = mx['indices'][indptr[i]:indptr[i + 1]]; dat = mx['data'][indptr[i]:indptr[i + 1]]
            for j, v in zip(idx, dat):
                out[names[j]] = out.get(names[j], 0) + int(v)
        return out
cellv = column('segmented_outputs/filtered_feature_cell_matrix.h5', [cell])
binv = column('binned_outputs/square_016um/filtered_feature_bc_matrix.h5', P16)
top = sorted(cellv.items(), key=lambda kv: -kv[1])[:5]
print('SR cell matrix total UMI', sum(cellv.values()), '| 16 um mapped-bin total UMI', sum(binv.values()))
for g, v in top:
    print('  gene', g, 'cell matrix', v, '| 16 um mapped bins', binv.get(g, 0))
gene = top[0][0]
with openr('feature_slice.h5') as f:
    h = h5py.File(f, 'r')
    names = [n.decode() for n in h['features/name'][:]]
    sl = h['feature_slices'][str(names.index(gene))]
    rows, cols, data = sl['row'][:], sl['col'][:], sl['data'][:]
s2 = set(zip(S2.r2, S2.c2))
sum2 = int(sum(int(d) for r, c, d in zip(rows, cols, data) if (int(r), int(c)) in s2))
print('gene', gene, 'sum over in_cell 2 um bins (feature slice)', sum2, '| cell matrix', cellv[gene])

print('== 3. graphclust labels across tiers')
c16 = pd.read_csv(io.BytesIO(fs.cat(B + '/binned_outputs/square_016um/analysis/clustering/gene_expression_graphclust/clusters.csv')))
raw8 = fs.cat_file(B + '/binned_outputs/square_008um/analysis/clustering/gene_expression_graphclust/clusters.csv', start=0, end=1_500_000)
raw8 = raw8[: raw8.rfind(b'\n')]
c8 = pd.read_csv(io.BytesIO(raw8))
r8, cc8 = rc(c8.Barcode)
c8['parent'] = [f's_016um_{r // 2:05d}_{c // 2:05d}-1' for r, c in zip(r8, cc8)]
m = c8.merge(c16.rename(columns={'Barcode': 'parent', 'Cluster': 'c16'}), on='parent')
print('8 um bins sampled', len(c8), 'with a clustered 16 um parent', len(m))
print('fraction of 8 um bins whose label equals their 16 um parent label: %.3f' % (m.Cluster == m.c16).mean())
ct = pd.crosstab(m.c16, m.Cluster)
best = ct.idxmax(axis=1)
print('16 um cluster -> most common 8 um label among its children (share):')
for k in ct.index[:16]:
    print('  16um', k, '-> 8um', best[k], '(%.2f)' % (ct.loc[k, best[k]] / ct.loc[k].sum()), '| same-number share %.2f' % (ct.loc[k].get(k, 0) / ct.loc[k].sum()))
