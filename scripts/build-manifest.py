#!/usr/bin/env python3
"""Generate manifest.json from the rustc WASM build output.

Scans the dist/ directory produced by x.py install and writes a JSON
manifest listing every file with its relative path and size. The manifest
lets the browser runtime discover rlib filenames without hard-coding the
hash-dependent names.
"""

import json
import sys
from pathlib import Path


def build_manifest(dist_dir: Path) -> dict:
    files = []
    total_size = 0
    for path in sorted(dist_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(dist_dir)
        size = path.stat().st_size
        files.append({"path": str(rel), "size": size})
        total_size += size
    return {"files": files, "totalSize": total_size}


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <dist-dir>", file=sys.stderr)
        sys.exit(1)

    dist_dir = Path(sys.argv[1])
    if not dist_dir.is_dir():
        print(f"Error: {dist_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    manifest = build_manifest(dist_dir)
    output = dist_dir / "manifest.json"
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {output} ({len(manifest['files'])} files, {manifest['totalSize']} bytes)")


if __name__ == "__main__":
    main()
