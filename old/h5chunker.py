from datetime import datetime
import os
import h5py
import ujson
from kerchunk.hdf import SingleHdf5ToZarr
import fsspec

SRC = "/Users/mp33/Downloads/feature_slice.h5"

storage_options = {
    "key": os.environ.get("AWS_ACCESS_KEY_ID",""),
    "secret": os.environ.get("AWS_SECRET_ACCESS_KEY",""),
    "client_kwargs": {"endpoint_url": os.environ.get("AWS_ENDPOINT_URL","")},
}

print(f"Start {datetime.now()}")
with fsspec.open(SRC, mode="rb", **storage_options) as inf:
    print(f"SingleHdf5ToZarr {datetime.now()}")
    h5chunks = SingleHdf5ToZarr(inf, inline_threshold=0)
    print(f"translate {datetime.now()}")
    refs = h5chunks.translate()
print(f"write {datetime.now()}")
with open("filtered_feature_bc_matrix.h5.json", "w") as f:
    f.write(ujson.dumps(refs))
print(f"done {datetime.now()}")