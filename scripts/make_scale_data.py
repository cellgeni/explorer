"""Write synthetic datasets at the scale where the viewer's costs show.

The fixtures in src/test/fixtures hold tens of cells; the optimization pass
(docs/plan/phases/optimization-pass.md) measures loads of a million or more.
This script writes, into a folder outside the repository:

- xenium/: a Xenium Onboard Analysis output folder (1.4 million cells by
  default, as many as the Xenium demo).
- scale.h5ad: an AnnData file (1 million cells by default) with
  obsm/spatial, an X_umap embedding, 20 numeric and 6 categorical obs
  columns, and a sparse X.

Both share one model of a tissue: cells on a jittered 10 um grid, in
clusters that are patches of the slide, each with five marker genes
(M01a to M20e) expressed by most of its cells. The other genes (G0100 and
on) are expressed at random, a few often and most rarely, and RARE1 by one
cell in 2,000. Everything is drawn from a seeded generator, so a run with the
same options writes the same data.

Serve the folder with scripts/range-server.mjs and open, for example,
http://127.0.0.1:4199/xenium/ or http://127.0.0.1:4199/scale.h5ad.

Usage (from the repository root):
    uv run --no-project --python 3.12 --with "numpy>=2" --with "pyarrow>=15" \\
        --with "h5py>=3.11" --with "zarr>=2.18,<3" --with "tifffile>=2024.8" \\
        python scripts/make_scale_data.py <out-folder> [options]

Options:
    --what xenium,h5ad   which datasets to write (default both)
    --xenium-cells N     cells in the Xenium output (1,400,000)
    --h5ad-cells N       cells in the H5AD (1,000,000)
    --genes N            genes in both (500)
    --genes-per-cell N   mean genes expressed per cell (40)
    --seed N             random seed (1)
"""

import argparse
import json
import time
import uuid
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import h5py
import numcodecs
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import tifffile
import zarr

CELL_PITCH_UM = 10.0
CELL_JITTER_UM = 2.5
SLIDE_ASPECT = 1.5
CLUSTERS = 20
MARKERS_PER_CLUSTER = 5
MARKER_EXPRESSED_SHARE = 0.8
RARE_GENE_SHARE = 1 / 2000
# Cells reassigned to a random cluster, so that clusters are not clean patches.
CLUSTER_NOISE_SHARE = 0.1
# Cells generated at a time while building the matrix, to bound memory.
MATRIX_BLOCK_CELLS = 200_000


class Tissue:
    """Cell positions, clusters and gene expression for one dataset."""

    def __init__(self, cells, genes, genes_per_cell, seed):
        if genes < CLUSTERS * MARKERS_PER_CLUSTER + 2:
            raise SystemExit(f"--genes must be at least {CLUSTERS * MARKERS_PER_CLUSTER + 2}")

        self.cells = cells
        self.genes = genes
        self.genes_per_cell = genes_per_cell
        self.rng = np.random.default_rng(seed)
        self.width_um = float(np.sqrt(SLIDE_ASPECT * cells) * CELL_PITCH_UM)
        self.x, self.y = self._positions()
        self.height_um = float(self.y.max() + CELL_PITCH_UM)
        self.cluster = self._clusters()
        self.gene_names = gene_names(genes)

    def _positions(self):
        columns = int(np.ceil(self.width_um / CELL_PITCH_UM))
        slot = np.arange(self.cells)
        jitter = self.rng.uniform(-CELL_JITTER_UM, CELL_JITTER_UM, (2, self.cells))
        x = (slot % columns + 0.5) * CELL_PITCH_UM + jitter[0]
        y = (slot // columns + 0.5) * CELL_PITCH_UM + jitter[1]

        return x, y

    def _clusters(self):
        # The nearest of CLUSTERS seeds, so each cluster is a patch of the slide.
        seeds = self.rng.uniform(0, 1, (CLUSTERS, 2)) * [self.width_um, self.height_um]
        cluster = np.empty(self.cells, dtype=np.int16)

        for start in range(0, self.cells, MATRIX_BLOCK_CELLS):
            end = min(start + MATRIX_BLOCK_CELLS, self.cells)
            dx = self.x[start:end, None] - seeds[None, :, 0]
            dy = self.y[start:end, None] - seeds[None, :, 1]
            cluster[start:end] = np.argmin(dx * dx + dy * dy, axis=1)

        noisy = self.rng.random(self.cells) < CLUSTER_NOISE_SHARE
        cluster[noisy] = self.rng.integers(0, CLUSTERS, int(noisy.sum()))

        return cluster

    def matrix_blocks(self):
        """Yield (first cell, indptr, gene indices, counts) per block of cells.

        Rows are cells in order and each row's genes are sorted and unique,
        as in a CSR matrix; the counts are whole numbers from 1.
        """
        markers = CLUSTERS * MARKERS_PER_CLUSTER
        rare = self.genes - 1
        background = np.arange(markers, rare)
        # A few background genes are common and most are rare (Zipf-like).
        weights = 1.0 / np.arange(1, background.size + 1) ** 0.8
        weights /= weights.sum()
        background_mean = max(self.genes_per_cell - MARKERS_PER_CLUSTER * MARKER_EXPRESSED_SHARE, 1)

        for start in range(0, self.cells, MATRIX_BLOCK_CELLS):
            end = min(start + MATRIX_BLOCK_CELLS, self.cells)
            count = end - start
            cluster = self.cluster[start:end].astype(np.int64)

            marker_on = self.rng.random((count, MARKERS_PER_CLUSTER)) < MARKER_EXPRESSED_SHARE
            marker_rows = np.repeat(np.arange(count), MARKERS_PER_CLUSTER)[marker_on.ravel()]
            marker_genes = (
                cluster[:, None] * MARKERS_PER_CLUSTER + np.arange(MARKERS_PER_CLUSTER)
            ).ravel()[marker_on.ravel()]

            per_cell = self.rng.poisson(background_mean, count)
            background_rows = np.repeat(np.arange(count), per_cell)
            background_genes = self.rng.choice(background, per_cell.sum(), p=weights)

            rare_rows = np.flatnonzero(self.rng.random(count) < RARE_GENE_SHARE)

            rows = np.concatenate([marker_rows, background_rows, rare_rows])
            genes = np.concatenate([marker_genes, background_genes, np.full(rare_rows.size, rare)])
            keys = np.unique(rows.astype(np.int64) * self.genes + genes)
            rows = keys // self.genes
            genes = (keys % self.genes).astype(np.int32)
            is_marker = genes < markers
            counts = 1 + self.rng.poisson(np.where(is_marker, 6.0, 1.0)).astype(np.uint32)
            indptr = np.searchsorted(rows, np.arange(count + 1)).astype(np.int64)

            yield start, indptr, genes, counts


def gene_names(genes):
    markers = [
        f"M{cluster + 1:02d}{'abcde'[marker]}"
        for cluster in range(CLUSTERS)
        for marker in range(MARKERS_PER_CLUSTER)
    ]
    background = [f"G{index:04d}" for index in range(len(markers), genes - 1)]

    return markers + background + ["RARE1"]


def string_array(values):
    return np.array(values, dtype=h5py.string_dtype("utf-8"))


# --- H5AD -------------------------------------------------------------------


def write_h5ad(path, tissue):
    """An AnnData file the viewer opens by its obsm/spatial, in micrometres.

    X is CSR with gzip-compressed chunks of 2^17 values, which the H5 worker
    reads by range. obs has an _index of cell IDs, 20 numeric columns and 6
    categorical ones; var's index is the gene names. No uns/spatial, which
    would make the viewer treat the coordinates as Visium pixels.
    """
    rng = np.random.default_rng(tissue.rng.integers(2**32))
    cells = tissue.cells

    with h5py.File(path, "w") as file:
        file.attrs["encoding-type"] = "anndata"
        file.attrs["encoding-version"] = "0.1.0"

        nnz, n_genes, total = write_h5ad_matrix(file, tissue)

        obs = file.create_group("obs")
        categorical = {
            "cluster": (tissue.cluster, [f"Cluster {index + 1:02d}" for index in range(CLUSTERS)]),
            "coarse_type": (tissue.cluster // 4, [f"Type {index + 1}" for index in range(CLUSTERS // 4)]),
            "cell_type": (
                tissue.cluster * 2 + rng.integers(0, 2, cells),
                [f"Cell type {index + 1:02d}" for index in range(CLUSTERS * 2)],
            ),
            "donor": (rng.integers(0, 8, cells), [f"Donor {index + 1}" for index in range(8)]),
            "batch": (rng.integers(0, 4, cells), [f"Batch {index + 1}" for index in range(4)]),
            "phase": (rng.integers(0, 3, cells), ["G1", "S", "G2M"]),
        }
        numeric = {
            "n_genes": n_genes.astype(np.int32),
            "total_counts": total.astype(np.float32),
            **{
                f"qc_{index + 1:02d}": rng.normal(index, 1 + index / 4, cells).astype(np.float32)
                for index in range(18)
            },
        }
        obs.attrs["encoding-type"] = "dataframe"
        obs.attrs["encoding-version"] = "0.2.0"
        obs.attrs["_index"] = "_index"
        obs.attrs["column-order"] = string_array([*categorical, *numeric])
        obs.create_dataset("_index", data=string_array(cell_ids(cells, "cell")))

        for name, (codes, categories) in categorical.items():
            group = obs.create_group(name)
            group.attrs["encoding-type"] = "categorical"
            group.attrs["encoding-version"] = "0.2.0"
            group.attrs["ordered"] = False
            group.create_dataset("codes", data=codes.astype(np.int8), **chunked(cells))
            group.create_dataset("categories", data=string_array(categories))

        for name, values in numeric.items():
            obs.create_dataset(name, data=values, **chunked(cells))

        var = file.create_group("var")
        var.attrs["encoding-type"] = "dataframe"
        var.attrs["encoding-version"] = "0.2.0"
        var.attrs["_index"] = "_index"
        var.attrs["column-order"] = string_array([])
        var.create_dataset("_index", data=string_array(tissue.gene_names))

        obsm = file.create_group("obsm")
        spatial = np.stack([tissue.x, tissue.y], axis=1).astype(np.float32)
        obsm.create_dataset("spatial", data=spatial, **chunked(cells, columns=2))
        obsm.create_dataset("X_umap", data=umap(tissue, rng), **chunked(cells, columns=2))

        file.create_group("uns")

    return nnz


def write_h5ad_matrix(file, tissue):
    group = file.create_group("X")
    group.attrs["encoding-type"] = "csr_matrix"
    group.attrs["encoding-version"] = "0.1.0"
    group.attrs["shape"] = np.array([tissue.cells, tissue.genes], dtype=np.int64)
    data = group.create_dataset(
        "data", shape=(0,), maxshape=(None,), dtype=np.float32, **chunked(None)
    )
    indices = group.create_dataset(
        "indices", shape=(0,), maxshape=(None,), dtype=np.int32, **chunked(None)
    )
    indptr = np.zeros(tissue.cells + 1, dtype=np.int64)
    n_genes = np.zeros(tissue.cells, dtype=np.int64)
    total = np.zeros(tissue.cells, dtype=np.float64)

    for start, block_indptr, genes, counts in tissue.matrix_blocks():
        offset = data.shape[0]
        data.resize((offset + counts.size,))
        indices.resize((offset + genes.size,))
        data[offset:] = counts.astype(np.float32)
        indices[offset:] = genes
        end = start + block_indptr.size - 1
        indptr[start + 1 : end + 1] = offset + block_indptr[1:]
        per_cell = np.diff(block_indptr)
        n_genes[start:end] = per_cell
        total[start:end] = np.bincount(
            np.repeat(np.arange(per_cell.size), per_cell), weights=counts, minlength=per_cell.size
        )

    group.create_dataset("indptr", data=indptr)

    return int(indptr[-1]), n_genes, total


def chunked(rows, columns=None):
    """gzip chunks of about 2^17 values, which the H5 worker reads by range."""
    if rows is None:
        return {"chunks": (2**17,), "compression": "gzip", "compression_opts": 4}

    chunk_rows = min(rows, 2**17 // (columns or 1))
    shape = (chunk_rows,) if columns is None else (chunk_rows, columns)

    return {"chunks": shape, "compression": "gzip", "compression_opts": 4}


def umap(tissue, rng):
    # A blob per cluster around a circle, like an embedding of the clusters.
    angle = tissue.cluster * (2 * np.pi / CLUSTERS)
    centres = np.stack([np.cos(angle), np.sin(angle)], axis=1) * 10
    return (centres + rng.normal(0, 1.2, (tissue.cells, 2))).astype(np.float32)


def cell_ids(cells, prefix):
    return [f"{prefix}{index:07d}" for index in range(cells)]


# --- Xenium ------------------------------------------------------------------

# Xenium writes a cell ID as the hex digits of a uint32 prefix shifted to the
# letters a-p, then "-1"; the matrix stores the prefix and the suffix.
XENIUM_ID_PREFIX_BASE = 0x1A2B0000
CELLS_ROW_GROUP = 65_536
BOUNDARY_VERTICES = 24
BOUNDARY_ROW_GROUP = 1_000_000
MATRIX_CHUNK = 2**21
IMAGE_TILE = 1024
# Cells drawn into the image at a time: each adds a few hundred pixels.
IMAGE_BLOCK_CELLS = 50_000
CHANNELS = [
    ("ch0000_dapi.ome.tif", "DAPI"),
    ("ch0001_atp1a1_cd45_e-cadherin.ome.tif", "ATP1A1/CD45/E-Cadherin"),
    ("ch0002_18s.ome.tif", "18S"),
    ("ch0003_alphasma_vimentin.ome.tif", "AlphaSMA/Vimentin"),
]


def write_xenium(folder, tissue, image_pixel_um, with_h5):
    """A Xenium Onboard Analysis output folder, as the viewer reads one.

    cells.parquet, the cell and nucleus outlines (25 rows a cell, each ring
    closed, cells in cells.parquet's order), cell_feature_matrix.zarr.zip
    with feature-major and cell-major arrays, analysis.zarr.zip with two
    clusterings, gene_panel.json, experiment.xenium, and a four-channel
    morphology_focus image, one OME-TIFF per channel with a SubIFD pyramid.
    No transcripts.
    """
    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(tissue.rng.integers(2**32))
    prefixes = (XENIUM_ID_PREFIX_BASE + np.arange(tissue.cells)).astype(np.uint32)
    ids = [shifted_hex(prefix) + "-1" for prefix in prefixes.tolist()]
    rows, genes, counts = matrix_entries(tissue)

    write_cells_parquet(folder / "cells.parquet", tissue, ids, rows, counts, rng)
    write_matrix_zarr(folder / "cell_feature_matrix.zarr.zip", tissue, prefixes, rows, genes, counts)
    write_analysis_zarr(folder / "analysis.zarr.zip", tissue)
    write_boundaries(folder / "cell_boundaries.parquet", tissue, ids, rng, radius=(3.5, 5.5))
    write_boundaries(
        folder / "nucleus_boundaries.parquet", tissue, ids, rng, radius=(2.0, 3.0), label_id=True
    )

    if with_h5:
        write_matrix_h5(folder / "cell_feature_matrix.h5", tissue, ids, rows, genes, counts)

    targets = [{"type": {"descriptor": "gene", "data": {"name": name}}} for name in tissue.gene_names]
    (folder / "gene_panel.json").write_text(json.dumps({"payload": {"targets": targets}}))

    images = folder / "morphology_focus"
    images.mkdir(exist_ok=True)
    write_morphology(images, tissue, image_pixel_um)

    experiment = {
        "major_version": 5,
        "minor_version": 0,
        "run_name": "synthetic",
        "region_name": "synthetic",
        "panel_name": "Synthetic panel",
        "panel_num_targets_predesigned": tissue.genes,
        "num_cells": tissue.cells,
        "pixel_size": image_pixel_um,
        "images": {"morphology_focus_filepath": f"morphology_focus/{CHANNELS[0][0]}"},
    }
    (folder / "experiment.xenium").write_text(json.dumps(experiment, indent=2))


def shifted_hex(prefix):
    return "".join(chr(ord("a") + int(digit, 16)) for digit in f"{prefix:08x}")


def matrix_entries(tissue):
    """Every stored value: cell row, gene index and count, cells in order."""
    rows, genes, counts = [], [], []

    for start, indptr, block_genes, block_counts in tissue.matrix_blocks():
        rows.append(start + np.repeat(np.arange(indptr.size - 1), np.diff(indptr)).astype(np.uint32))
        genes.append(block_genes)
        counts.append(block_counts)

    return np.concatenate(rows), np.concatenate(genes), np.concatenate(counts)


def write_cells_parquet(path, tissue, ids, rows, counts, rng):
    # DOUBLE centroids, INT64 counts and ZSTD, as Xenium Ranger writes them;
    # pyarrow's row-group statistics let DuckDB skip groups outside a box.
    transcripts = np.bincount(rows, weights=counts, minlength=tissue.cells).astype(np.int64)
    cell_area = rng.uniform(40, 120, tissue.cells)
    table = pa.table(
        {
            "cell_id": pa.array(ids, pa.string()),
            "x_centroid": pa.array(tissue.x, pa.float64()),
            "y_centroid": pa.array(tissue.y, pa.float64()),
            "transcript_counts": pa.array(transcripts, pa.int64()),
            "control_probe_counts": pa.array(np.zeros(tissue.cells, np.int64)),
            "total_counts": pa.array(transcripts, pa.int64()),
            "cell_area": pa.array(cell_area, pa.float64()),
            "nucleus_area": pa.array(cell_area * rng.uniform(0.2, 0.4, tissue.cells), pa.float64()),
            "nucleus_count": pa.array(np.ones(tissue.cells, np.int64)),
            "segmentation_method": pa.array(
                np.where(
                    rng.random(tissue.cells) < 0.8,
                    "Segmented by boundary stain (ATP1A1+CD45+E-Cadherin)",
                    "Segmented by nucleus expansion of 5.0µm",
                ),
                pa.string(),
            ),
        }
    )
    pq.write_table(table, path, row_group_size=CELLS_ROW_GROUP, compression="zstd")


def write_matrix_zarr(path, tissue, prefixes, rows, genes, counts):
    """cell_features as XOA writes it, in an uncompressed zip.

    The feature-major arrays (indptr over genes, indices of cell rows) serve
    gene colouring; csc/ (indptr over cells, uint16 gene indices) serves a
    cell's or a region's genes.
    """
    compressor = numcodecs.Blosc(cname="zstd", clevel=5, shuffle=numcodecs.Blosc.SHUFFLE)
    store = zarr.ZipStore(str(path), mode="w", compression=zipfile.ZIP_STORED)
    root = zarr.group(store=store)
    features = root.create_group("cell_features")
    # One write: each attrs assignment adds another .zattrs entry to the zip.
    features.attrs.update(
        {
            "feature_keys": tissue.gene_names,
            "feature_types": ["gene"] * tissue.genes,
            "number_cells": tissue.cells,
            "number_features": tissue.genes,
        }
    )

    def array(name, values, chunks):
        features.create_dataset(name, data=values, chunks=chunks, compressor=compressor)

    cell_id = np.stack([prefixes, np.ones(tissue.cells, np.uint32)], axis=1)
    array("cell_id", cell_id, (min(tissue.cells, 2**20), 2))

    by_gene = np.argsort(genes, kind="stable")
    gene_indptr = np.concatenate([[0], np.cumsum(np.bincount(genes, minlength=tissue.genes))])
    array("indptr", gene_indptr.astype(np.uint32), (tissue.genes + 1,))
    array("indices", rows[by_gene], (MATRIX_CHUNK,))
    array("data", counts[by_gene], (MATRIX_CHUNK,))

    cell_indptr = np.concatenate([[0], np.cumsum(np.bincount(rows, minlength=tissue.cells))])
    array("csc/indptr", cell_indptr.astype(np.uint32), (2**20,))
    array("csc/indices", genes.astype(np.uint16), (MATRIX_CHUNK,))
    array("csc/data", counts, (MATRIX_CHUNK,))
    store.close()


def write_analysis_zarr(path, tissue):
    # Two clusterings, as Xenium's graph-based and k-means ones: each group's
    # cell rows, sorted, with an indptr over the groups.
    groupings = [
        ("gene_expression_graphclust", tissue.cluster, CLUSTERS),
        ("gene_expression_kmeans_5_clusters", tissue.cluster // 4, CLUSTERS // 4),
    ]
    store = zarr.ZipStore(str(path), mode="w", compression=zipfile.ZIP_STORED)
    root = zarr.group(store=store)
    groups = root.create_group("cell_groups")
    groups.attrs.update(
        {
            "grouping_names": [name for name, _, _ in groupings],
            "group_names": [
                [f"Cluster {index + 1}" for index in range(count)] for _, _, count in groupings
            ],
            "number_groupings": len(groupings),
        }
    )

    for index, (_, labels, count) in enumerate(groupings):
        group = groups.create_group(str(index))
        order = np.argsort(labels, kind="stable").astype(np.uint32)
        indptr = np.concatenate([[0], np.cumsum(np.bincount(labels, minlength=count))])
        group.create_dataset("indptr", data=indptr.astype(np.uint32))
        group.create_dataset("indices", data=order, chunks=(2**20,))

    store.close()


def write_boundaries(path, tissue, ids, rng, radius, label_id=False):
    """Outlines of BOUNDARY_VERTICES points plus the first again, per cell.

    Float32 vertices (as Xenium's), each cell's rows together, cells in
    cells.parquet's order, in row groups of a million rows.
    """
    angles = np.linspace(0, 2 * np.pi, BOUNDARY_VERTICES, endpoint=False)
    angles = np.concatenate([angles, angles[:1]])
    rows_per_cell = angles.size
    cells_per_group = BOUNDARY_ROW_GROUP // rows_per_cell
    schema = pa.schema(
        [
            ("cell_id", pa.string()),
            ("vertex_x", pa.float32()),
            ("vertex_y", pa.float32()),
            *([("label_id", pa.int32())] if label_id else []),
        ]
    )

    with pq.ParquetWriter(path, schema, compression="zstd") as writer:
        for start in range(0, tissue.cells, cells_per_group):
            end = min(start + cells_per_group, tissue.cells)
            count = end - start
            size = rng.uniform(*radius, count)[:, None]
            wobble = 1 + 0.12 * np.sin(3 * angles[None, :] + rng.uniform(0, 2 * np.pi, (count, 1)))
            x = tissue.x[start:end, None] + size * wobble * np.cos(angles)[None, :]
            y = tissue.y[start:end, None] + size * wobble * np.sin(angles)[None, :]
            columns = {
                "cell_id": pa.array(np.repeat(ids[start:end], rows_per_cell), pa.string()),
                "vertex_x": pa.array(x.ravel().astype(np.float32)),
                "vertex_y": pa.array(y.ravel().astype(np.float32)),
            }

            if label_id:
                columns["label_id"] = pa.array(
                    np.repeat(np.arange(start + 1, end + 1, dtype=np.int32), rows_per_cell)
                )

            writer.write_table(pa.table(columns, schema=schema), row_group_size=BOUNDARY_ROW_GROUP)


def write_matrix_h5(path, tissue, ids, rows, genes, counts):
    # The 10x feature-barcode HDF5 layout: a column per cell (barcode).
    with h5py.File(path, "w") as file:
        matrix = file.create_group("matrix")
        matrix.create_dataset("barcodes", data=np.array(ids, dtype="S"), **chunked(len(ids)))
        matrix.create_dataset("data", data=counts.astype(np.int32), **chunked(counts.size))
        matrix.create_dataset("indices", data=genes.astype(np.int64), **chunked(genes.size))
        indptr = np.concatenate([[0], np.cumsum(np.bincount(rows, minlength=tissue.cells))])
        matrix.create_dataset("indptr", data=indptr.astype(np.int64))
        matrix.create_dataset("shape", data=np.array([tissue.genes, tissue.cells], np.int32))
        features = matrix.create_group("features")
        names = np.array(tissue.gene_names, dtype="S")
        features.create_dataset("id", data=names)
        features.create_dataset("name", data=names)
        features.create_dataset("feature_type", data=np.array([b"Gene Expression"] * tissue.genes))
        features.create_dataset("genome", data=np.array([b"Synthetic"] * tissue.genes))
        features.create_dataset("_all_tag_keys", data=np.array([b"genome"]))


def write_morphology(folder, tissue, pixel_um):
    """One uint16 OME-TIFF per channel, tiled, deflate, with SubIFD levels.

    Every file holds the OME-XML of all four, whose TiffData names the file
    of each channel, as Xenium Onboard Analysis 2 and later write them. The
    unit is written "um": tifffile writes ASCII descriptions only.
    """
    width = int(np.ceil((tissue.width_um + CELL_PITCH_UM) / pixel_um))
    height = int(np.ceil((tissue.height_um + CELL_PITCH_UM) / pixel_um))
    uuids = [f"urn:uuid:{uuid.UUID(int=index + 1)}" for index in range(len(CHANNELS))]

    for index, (file_name, _) in enumerate(CHANNELS):
        image = render_channel(tissue, index, width, height, pixel_um)
        levels = [image]

        while max(levels[-1].shape) > IMAGE_TILE:
            levels.append(downsample(levels[-1]))

        xml = ome_xml(width, height, pixel_um, uuids, index)

        with tifffile.TiffWriter(folder / file_name, bigtiff=True) as tif:
            options = {
                "tile": (IMAGE_TILE, IMAGE_TILE),
                "compression": "zlib",
                "photometric": "minisblack",
                "metadata": None,
            }
            tif.write(image, subifds=len(levels) - 1, description=xml, **options)

            for level in levels[1:]:
                tif.write(level, subfiletype=1, **options)


def render_channel(tissue, channel, width, height, pixel_um):
    # DAPI: a nucleus at each cell; the boundary stain: a ring; 18S: the
    # cytoplasm; AlphaSMA/Vimentin: the cytoplasm of five clusters only.
    image = np.full((height, width), 80, dtype=np.uint16)
    radius_um = {0: 2.5, 1: 4.5, 2: 4.0, 3: 4.0}[channel]
    reach = int(np.ceil((radius_um + 2.5) / pixel_um))
    offsets = np.arange(-reach, reach + 1)
    dy, dx = np.meshgrid(offsets, offsets, indexing="ij")
    distance = np.hypot(dx, dy) * pixel_um

    if channel == 1:
        kernel = np.exp(-((distance - radius_um) ** 2) / (2 * 0.8**2))
    else:
        kernel = np.exp(-(distance**2) / (2 * (radius_um / 1.5) ** 2))

    kernel = (kernel * {0: 3000, 1: 1500, 2: 800, 3: 1200}[channel]).ravel()
    keep = np.ones(tissue.cells, bool) if channel != 3 else tissue.cluster < 5
    px = np.round(tissue.x / pixel_um).astype(np.int64)
    py = np.round(tissue.y / pixel_um).astype(np.int64)

    # Bands of rows bound the memory: cells are in row order on the slide.
    for start in range(0, tissue.cells, IMAGE_BLOCK_CELLS):
        end = min(start + IMAGE_BLOCK_CELLS, tissue.cells)
        selected = np.flatnonzero(keep[start:end]) + start

        if selected.size == 0:
            continue

        top = max(int(py[start:end].min()) - reach, 0)
        bottom = min(int(py[start:end].max()) + reach + 1, height)
        ys = (py[selected, None] + dy.ravel()[None, :]).clip(top, bottom - 1) - top
        xs = (px[selected, None] + dx.ravel()[None, :]).clip(0, width - 1)
        band = np.bincount(
            (ys * width + xs).ravel(),
            weights=np.broadcast_to(kernel, ys.shape).ravel(),
            minlength=(bottom - top) * width,
        )
        image[top:bottom] = np.minimum(
            image[top:bottom] + band.reshape(bottom - top, width), 65535
        ).astype(np.uint16)

    return image


def downsample(image):
    height, width = (image.shape[0] // 2) * 2, (image.shape[1] // 2) * 2
    blocks = image[:height, :width].reshape(height // 2, 2, width // 2, 2)
    return blocks.mean(axis=(1, 3)).astype(np.uint16)


def ome_xml(width, height, pixel_um, uuids, own):
    channels = "".join(
        f'<Channel ID="Channel:0:{index}" Name="{escape(name)}" SamplesPerPixel="1" />'
        for index, (_, name) in enumerate(CHANNELS)
    )
    tiff_data = "".join(
        f'<TiffData FirstC="{index}" FirstT="0" FirstZ="0" IFD="0" PlaneCount="1">'
        f'<UUID FileName="{file_name}">{uuids[index]}</UUID></TiffData>'
        for index, (file_name, _) in enumerate(CHANNELS)
    )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06" '
        f'UUID="{uuids[own]}">'
        '<Image ID="Image:0" Name="morphology_focus">'
        f'<Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="{width}" '
        f'SizeY="{height}" SizeZ="1" SizeC="{len(CHANNELS)}" SizeT="1" '
        f'PhysicalSizeX="{pixel_um}" PhysicalSizeXUnit="um" '
        f'PhysicalSizeY="{pixel_um}" PhysicalSizeYUnit="um">'
        f"{channels}{tiff_data}</Pixels></Image></OME>"
    )


# --- Main --------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--what", default="xenium,h5ad")
    parser.add_argument("--xenium-cells", type=int, default=1_400_000)
    parser.add_argument("--h5ad-cells", type=int, default=1_000_000)
    parser.add_argument("--genes", type=int, default=500)
    parser.add_argument("--genes-per-cell", type=float, default=40)
    parser.add_argument("--image-pixel-um", type=float, default=0.85)
    parser.add_argument("--with-h5", action="store_true")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    what = set(args.what.split(","))
    args.out.mkdir(parents=True, exist_ok=True)

    if "xenium" in what:
        started = time.time()
        tissue = Tissue(args.xenium_cells, args.genes, args.genes_per_cell, args.seed)
        folder = args.out / "xenium"
        write_xenium(folder, tissue, args.image_pixel_um, args.with_h5)
        size = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
        print(
            f"{folder}: {tissue.cells:,} cells, {tissue.genes} genes, "
            f"{size / 1e6:.0f} MB in {time.time() - started:.0f} s"
        )

    if "h5ad" in what:
        started = time.time()
        tissue = Tissue(args.h5ad_cells, args.genes, args.genes_per_cell, args.seed)
        path = args.out / "scale.h5ad"
        nnz = write_h5ad(path, tissue)
        print(
            f"{path}: {tissue.cells:,} cells, {tissue.genes} genes, {nnz:,} values, "
            f"{path.stat().st_size / 1e6:.0f} MB in {time.time() - started:.0f} s"
        )


if __name__ == "__main__":
    main()
