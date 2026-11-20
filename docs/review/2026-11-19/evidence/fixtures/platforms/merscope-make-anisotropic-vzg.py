"""Writes merscope-anisotropic.vzg: a copy of the repository's MERSCOPE
fixture src/test/fixtures/merscope/region_0.vzg (ZIP64, deflated) with only
pictures/micron_to_mosaic_pixel_transform.csv replaced by an anisotropic,
asymmetric transform: x' = 2 x - 2000, y' = 4 y - 12000 (um -> mosaic px).
Expected placement (by hand): origin (1000, 3000) um; 0.5 um/px in x and
0.25 um/px in y. Stdlib only:
    python3 docs/review/2026-11-19/evidence/fixtures/platforms/merscope-make-anisotropic-vzg.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
SOURCE = ROOT / "src/test/fixtures/merscope/region_0.vzg"
TARGET = Path(__file__).resolve().parent / "merscope-anisotropic.vzg"
TRANSFORM = "2 0 -2000\n0 4 -12000\n0 0 1\n"

with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(TARGET, "w") as target:
    for info in source.infolist():
        data = source.read(info.filename)
        if info.filename == "pictures/micron_to_mosaic_pixel_transform.csv":
            data = TRANSFORM.encode()
        out = zipfile.ZipInfo(info.filename, date_time=(2024, 1, 1, 0, 0, 0))
        out.compress_type = zipfile.ZIP_DEFLATED
        with target.open(out, "w", force_zip64=True) as entry:
            entry.write(data)
print(TARGET, TARGET.stat().st_size)
