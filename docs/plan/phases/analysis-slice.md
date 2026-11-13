# Analysis Slice (Pulled Ahead Of Phase 4 By The User)

- [x] Gene selection from `gene_panel.json`, without loading matrices until a
      workflow needs them.
- [x] Gene-expression highlighting.
- [x] Colour cells by observations (`transcript_counts`, `cell_area`,
      `nucleus_area`, and later imported labels).
- [x] Cell information: metadata, observations, and selected-gene expression.

Notes:

- Expression reads `cell_feature_matrix.zarr.zip` through
  `XeniumDataset.matrix()` after collecting viewport cell IDs from
  `cells.parquet`. At first it was capped at 5,000 visible cells.
- `Cell fill opacity` and `Cell boundary opacity` are separate. Zero fill keeps
  transparent polygons pickable.
- Changing the colour scale restyles loaded counts without refetching.
