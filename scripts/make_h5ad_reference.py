"""Write a `.h5ad.json` reference or `.h5ad.icechunk` repository for an H5AD file over 300 MiB.

The reference is a JSON object in kerchunk's reference format. It describes
the H5AD as a Zarr v2 store: group and array metadata sit under `.zgroup`,
`.zattrs`, and `.zarray` keys, and each chunk key maps to the byte range of
that chunk in the H5AD: `[url, offset, size]`. Variable-length strings (obs
and var names, category labels) cannot be referenced and are stored in the
JSON itself. The viewer loads the JSON in one request and then reads only the
chunks it needs from the H5AD with Range requests.

With --icechunk, the same references are written to an Icechunk repository
instead: a Zarr v3 store whose chunks are virtual references to byte ranges of
the H5AD, and whose strings are stored in the repository. The HDF5 file is
parsed with VirtualiZarr. See docs/h5ad-reference.md.

Usage:
    python scripts/make_h5ad_reference.py sample.h5ad
    python scripts/make_h5ad_reference.py --icechunk sample.h5ad

Requires: pip install "virtualizarr[hdf]>=2.8", or "virtualizarr[hdf,icechunk]>=2.8"
for --icechunk.
"""

import argparse
import base64
import json
import os
import sys
import zlib
from pathlib import Path

import h5py
from obspec_utils.registry import ObjectStoreRegistry
from obstore.store import LocalStore
from virtualizarr.parsers import HDFParser
from virtualizarr.writers.kerchunk import NumpyEncoder, variable_to_kerchunk_arr_refs

# Groups the viewer reads. Everything else (raw, layers, obsp, varm, varp, and
# uns other than uns/spatial) is left out unless --all is given.
VIEWER_GROUPS = ("obs", "var", "obsm", "X")
INLINE_PREFIX = "base64:"
# Icechunk stores chunks up to this size inside the array's manifest, which the
# viewer reads anyway, instead of as separate objects; 65,535 bytes is the most
# it allows. The chunks written to the repository are the strings; the H5AD's
# chunks stay virtual.
ICECHUNK_INLINE_CHUNK_BYTES = 65_535


def used_by_viewer(name):
    parts = name.split("/")

    if parts[0] in VIEWER_GROUPS:
        return True
    if parts[0] != "uns":
        return False
    if len(parts) == 1:
        return True
    # Visium: scale factors and the hires and lowres images. The viewer never
    # reads a full-resolution image, which can be most of the file.
    return parts[1] == "spatial" and not (len(parts) > 4 and parts[3:5] == ["images", "fullres"])


def check_h5ad(h5ad_path, keep_all):
    """Refuse files whose referenced arrays the viewer could not read, and warn about slow ones."""
    unsupported = []
    contiguous = []

    def visit(name, obj):
        if not isinstance(obj, h5py.Dataset) or not (keep_all or used_by_viewer(name)):
            return
        if obj.compression in ("lzf", "szip"):
            unsupported.append(f"{name} ({obj.compression})")
        if name == "X" and obj.chunks is None and obj.nbytes > 64 * 1024 * 1024:
            contiguous.append(name)

    with h5py.File(h5ad_path, "r") as h5:
        h5.visititems(visit)
        matrix = h5.get("X")
        encoding = matrix.attrs.get("encoding-type", "array") if matrix is not None else None

    if unsupported:
        more = f" and {len(unsupported) - 3} more" if len(unsupported) > 3 else ""
        raise ValueError(
            f"the viewer cannot decode lzf or szip compressed arrays: {', '.join(unsupported[:3])}{more}. "
            'Rewrite the file with gzip: adata.write_h5ad(path, compression="gzip").'
        )
    for name in contiguous:
        print(
            f"Warning: /{name} is one unchunked block, so the first gene read downloads all of it. "
            'Rewrite with adata.write_h5ad(path, compression="gzip") to chunk it.',
            file=sys.stderr,
        )

    return encoding


def compress_inlined(array_refs):
    """zlib-compress an array stored whole in the JSON (VirtualiZarr writes it uncompressed)."""
    chunks = [value for key, value in array_refs.items() if not key.startswith(".")]

    if not chunks or not all(isinstance(value, str) and value.startswith(INLINE_PREFIX) for value in chunks):
        return array_refs

    metadata = json.loads(array_refs[".zarray"])

    if metadata.get("compressor") is not None:
        return array_refs

    metadata["compressor"] = {"id": "zlib", "level": 9}
    compressed = {".zarray": json.dumps(metadata, separators=(",", ":"))}

    for key, value in array_refs.items():
        if not key.startswith("."):
            raw = base64.b64decode(value[len(INLINE_PREFIX) :])
            value = INLINE_PREFIX + base64.b64encode(zlib.compress(raw, 9)).decode()
        compressed.setdefault(key, value)

    return compressed


def add_group(refs, group, path, file_name, keep_all):
    prefix = f"{path}/" if path else ""
    refs[f"{prefix}.zgroup"] = json.dumps({"zarr_format": 2})
    refs[f"{prefix}.zattrs"] = json.dumps(group.metadata.attributes, cls=NumpyEncoder, separators=(",", ":"))

    for name, array in group.arrays.items():
        array_path = f"{prefix}{name}"
        if not (keep_all or used_by_viewer(array_path)):
            continue
        # One array at a time. AnnData arrays have no HDF5 dimension scales, so
        # every axis 0 gets the same placeholder name, and VirtualiZarr's
        # Dataset and DataTree writers (through xarray) reject a group whose
        # arrays disagree on its length, such as X/data and X/indptr.
        array_refs = variable_to_kerchunk_arr_refs(array.to_virtual_variable(), name)
        for key, value in compress_inlined(array_refs).items():
            if isinstance(value, list):
                # The viewer ignores the URL in each chunk entry and reads the
                # H5AD next to the JSON, so the file name is enough.
                value = [file_name, *value[1:]]
            refs[f"{array_path}/{key}"] = value

    for name, subgroup in group.groups.items():
        group_path = f"{prefix}{name}"
        if keep_all or used_by_viewer(group_path):
            add_group(refs, subgroup, group_path, file_name, keep_all)


def parse_h5ad(path):
    """The H5AD's group tree, with each array's chunk manifest."""
    registry = ObjectStoreRegistry({"file://": LocalStore()})
    # links_and_references stores HDF5 object references as paths. Older
    # AnnData files keep categories in one (an obs column's `categories`
    # attribute), which cannot be written as JSON otherwise.
    store = HDFParser(links_and_references=True)(f"file://{path}", registry)
    # The parsed group tree; ManifestStore has no public accessor for it.
    return store._group


def build_reference(h5ad_path, keep_all):
    path = h5ad_path.resolve()
    refs = {}
    add_group(refs, parse_h5ad(path), "", path.name, keep_all)
    return {"version": 1, "refs": refs}


def add_icechunk_group(store, zarr_group, group, path, keep_all, location):
    from virtualizarr.manifests.manifest import INLINED_CHUNK_PATH
    from virtualizarr.writers.icechunk import write_virtual_variable_to_icechunk

    zarr_group.attrs.update(group.metadata.attributes)

    for name, array in group.arrays.items():
        array_path = f"{path}/{name}" if path else name
        if not (keep_all or used_by_viewer(array_path)):
            continue
        # One array at a time, for the same reason as add_group. Strings read
        # from the H5AD are written to the repository as ordinary chunks.
        variable = array.to_virtual_variable()
        if location is not None:
            # Only the H5AD's chunks: a string passed to rename_paths would
            # also replace the markers of missing and inlined chunks.
            renamed = variable.data.rename_paths(lambda old: old if old in ("", INLINED_CHUNK_PATH) else location)
            variable = variable.copy(data=renamed)
        write_virtual_variable_to_icechunk(store, zarr_group, name, variable)

    for name, subgroup in group.groups.items():
        group_path = f"{path}/{name}" if path else name
        if keep_all or used_by_viewer(group_path):
            add_icechunk_group(store, zarr_group.require_group(name), subgroup, group_path, keep_all, location)


def write_icechunk(h5ad_path, output, keep_all, url):
    """Write the references to a new Icechunk repository at `output`, on its main branch."""
    # Icechunk warns that local repositories are unsafe for concurrent commits;
    # this script is the only writer.
    os.environ.setdefault("ICECHUNK_LOG", "error")
    import icechunk
    import zarr

    if output.exists():
        raise ValueError(f"{output} already exists; remove it or choose another path with -o")

    path = h5ad_path.resolve()
    # Icechunk needs an absolute URL for each virtual chunk. The viewer reads
    # the chunks from the H5AD next to the repository whatever is stored; other
    # tools use the stored URL, so --url gives the hosted one.
    location = url or f"file://{path}"

    if location.startswith(("http://", "https://")):
        container_store = icechunk.http_store()
    elif url is None:
        container_store = icechunk.local_filesystem_store(str(path.parent))
    else:
        raise ValueError(f"--url must be an http:// or https:// URL, not {url}")

    config = icechunk.RepositoryConfig.default()
    config.inline_chunk_threshold_bytes = ICECHUNK_INLINE_CHUNK_BYTES
    config.set_virtual_chunk_container(icechunk.VirtualChunkContainer(location.rsplit("/", 1)[0] + "/", container_store))
    group = parse_h5ad(path)
    repo = icechunk.Repository.create(icechunk.local_filesystem_storage(str(output)), config)
    session = repo.writable_session("main")
    root = zarr.open_group(session.store, mode="w", zarr_format=3)
    add_icechunk_group(session.store, root, group, "", keep_all, None if url is None else location)
    session.commit(f"Virtual references to {path.name}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("h5ad", type=Path, help="H5AD file on local disk")
    parser.add_argument(
        "-o", "--output", type=Path, help="Output path (default: <h5ad>.json, or <h5ad>.icechunk with --icechunk)"
    )
    parser.add_argument(
        "--icechunk",
        action="store_true",
        help='Write an Icechunk repository instead of JSON (needs "virtualizarr[hdf,icechunk]>=2.8")',
    )
    parser.add_argument(
        "--url",
        help=(
            "With --icechunk, the H5AD's hosted http(s) URL, stored in each virtual chunk for tools other "
            "than the viewer (default: the local file:// path)"
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help=(
            "Reference every group, not only those the viewer reads (for other tools; the viewer "
            "cannot open structured arrays such as scanpy's uns/rank_genes_groups)"
        ),
    )
    args = parser.parse_args(argv)

    if args.url is not None and not args.icechunk:
        parser.error("--url needs --icechunk; the viewer ignores the URL stored in a JSON reference")

    suffix = ".icechunk" if args.icechunk else ".json"
    outfile = args.output or args.h5ad.with_name(args.h5ad.name + suffix)

    try:
        encoding = check_h5ad(args.h5ad, args.all)
        if args.icechunk:
            write_icechunk(args.h5ad, outfile, args.all, args.url)
        else:
            reference = build_reference(args.h5ad, args.all)
    except (OSError, ValueError, NotImplementedError) as error:
        sys.exit(f"{args.h5ad}: {error}")

    if args.icechunk:
        files = [file for file in outfile.rglob("*") if file.is_file()]
        size = sum(file.stat().st_size for file in files)
        print(f"Wrote {outfile} ({size / 1e6:.2f} MB in {len(files)} files)")
    else:
        with open(outfile, "w") as f:
            json.dump(reference, f, separators=(",", ":"))

        refs = reference["refs"]
        narrays = sum(1 for key in refs if key.endswith(".zarray"))
        nchunks = sum(1 for value in refs.values() if isinstance(value, list))
        print(f"Wrote {outfile} ({outfile.stat().st_size / 1e6:.2f} MB, {narrays} arrays, {nchunks} chunk ranges)")

    if encoding == "csr_matrix":
        print(
            "/X is CSR: colouring by a gene reads the rows of every cell in view. "
            "CSC reads one column per gene instead; see docs/h5ad-reference.md."
        )


if __name__ == "__main__":
    main()
