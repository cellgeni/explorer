"""FMT review: validate probes, examples, docs/collections and the JSON code
blocks in README.md and docs/ against the JSON Schemas in public/schemas,
with jsonschema's Draft 2020-12 validator (independent of the app's parser).

Run from the repository root:
  uv run --offline --no-project --with jsonschema python \
    docs/review/2026-11-19/evidence/docs-formats/schema_validate.py
Writes docs/review/2026-11-19/evidence/docs-formats/schema-results.json and
docs-json-blocks.json (the extracted blocks, for the parser repro).
"""
import glob
import json
import os
import re
import sys

from jsonschema import Draft202012Validator, FormatChecker

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "docs/review/2026-11-19/evidence/docs-formats")
FIX = os.path.join(ROOT, "docs/review/2026-11-19/evidence/fixtures/docs-formats")


def load_schema(name):
    with open(os.path.join(ROOT, "public/schemas", name)) as f:
        schema = json.load(f)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


VALIDATORS = {
    "manifest": load_schema("explorer-manifest.v1.json"),
    "collection": load_schema("explorer-collection.v1.json"),
}


def validate(kind, doc):
    errors = sorted(VALIDATORS[kind].iter_errors(doc), key=lambda e: list(e.path))
    return [
        {"path": "/".join(str(p) for p in e.absolute_path), "message": e.message[:200]}
        for e in errors
    ]


def kind_of(doc):
    if isinstance(doc, dict) and "datasets" in doc and "platform" not in doc:
        return "collection"
    if isinstance(doc, dict) and ("platform" in doc or "version" in doc):
        return "manifest"
    return None


results = {"probes": [], "files": [], "docBlocks": []}

with open(os.path.join(FIX, "probes.json")) as f:
    probes = json.load(f)["probes"]

for probe in probes:
    if "generate" in probe:
        doc = {"version": 1, "datasets": [{"dataset": f"d{i}"} for i in range(501)]}
    elif "jsonText" in probe:
        doc = json.loads(probe["jsonText"])
    else:
        doc = probe["json"]
    errors = validate(probe["kind"], doc)
    results["probes"].append(
        {
            "id": probe["id"],
            "schemaValid": not errors,
            "expectSchema": probe["expectSchema"],
            "errors": errors[:3],
        }
    )

files = sorted(
    glob.glob(os.path.join(ROOT, "examples/**/*.json"), recursive=True)
    + glob.glob(os.path.join(ROOT, "docs/collections/*.json"))
)
for path in files:
    rel = os.path.relpath(path, ROOT)
    if rel == "examples/index.json":
        continue
    with open(path) as f:
        doc = json.load(f)
    kind = kind_of(doc)
    errors = validate(kind, doc) if kind else [{"path": "", "message": "not a manifest or collection"}]
    results["files"].append({"file": rel, "kind": kind, "schemaValid": not errors, "errors": errors[:5]})

blocks = []
md_files = [os.path.join(ROOT, "README.md")] + sorted(
    glob.glob(os.path.join(ROOT, "docs/*.md")) + glob.glob(os.path.join(ROOT, "docs/modalities/*.md"))
)
fence = re.compile(r"^```json\s*$")
for path in md_files:
    rel = os.path.relpath(path, ROOT)
    with open(path) as f:
        lines = f.read().split("\n")
    i = 0
    while i < len(lines):
        if fence.match(lines[i]):
            start = i + 1
            j = start
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            text = "\n".join(lines[start:j])
            entry = {"file": rel, "line": start + 1, "text": text}
            try:
                doc = json.loads(text)
            except Exception as exc:  # noqa: BLE001
                entry.update({"parsed": False, "kind": None, "parseError": str(exc)[:120]})
            else:
                kind = kind_of(doc)
                entry.update({"parsed": True, "kind": kind})
                if kind:
                    errors = validate(kind, doc)
                    entry.update({"schemaValid": not errors, "errors": errors[:5]})
            blocks.append(entry)
            i = j + 1
        else:
            i += 1

results["docBlocks"] = [{k: v for k, v in b.items() if k != "text"} for b in blocks]

with open(os.path.join(OUT, "schema-results.json"), "w") as f:
    json.dump(results, f, indent=1)
with open(os.path.join(OUT, "docs-json-blocks.json"), "w") as f:
    json.dump(blocks, f, indent=1)

mismatch = [p for p in results["probes"] if p["schemaValid"] != p["expectSchema"]]
print(f"probes: {len(results['probes'])}, schema verdict differs from expectation: {len(mismatch)}")
for p in mismatch:
    print("  ", p["id"], "schemaValid=", p["schemaValid"], p["errors"][:1])
bad_files = [r for r in results["files"] if not r["schemaValid"]]
print(f"example/collection files: {len(results['files'])}, schema-invalid: {len(bad_files)}")
for r in bad_files:
    print("  ", r["file"], r["errors"][:3])
checked = [b for b in results["docBlocks"] if b.get("kind")]
bad_blocks = [b for b in checked if not b.get("schemaValid")]
unparsed = [b for b in results["docBlocks"] if not b["parsed"]]
print(f"doc json blocks: {len(results['docBlocks'])}, manifest/collection blocks: {len(checked)}, schema-invalid: {len(bad_blocks)}, not JSON: {len(unparsed)}")
for b in bad_blocks:
    print("  ", b["file"], b["line"], b["kind"], b["errors"][:3])
for b in unparsed:
    print("   not JSON:", b["file"], b["line"], b["parseError"])
