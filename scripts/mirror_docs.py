#!/usr/bin/env python3
"""Copy the API documentation's machine-read files, for serving at /docs/.

TauCeti publishes the documentation, with `SOURCE_SHA` (the commit it describes) and
`facts.json.gz` (its declarations), at taucetiproject.github.io/TauCeti/docs/. Tools written while
the documentation was at taucetiproject.org/docs/ read those two there, and 404.html redirects
browsers only. The pair is kept only when both describe one commit, and replaces the previous
pair together; on failure the previous pair stays.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

DOCS = "https://taucetiproject.github.io/TauCeti/docs/"
FILES = ("SOURCE_SHA", "facts.json.gz")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "tauceti-website-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def consistent_pair(base: str = DOCS, fetch=fetch, attempts: int = 3) -> dict[str, bytes]:
    """`{name: bytes}` for the two files, read while both describe the same commit."""
    seen = "nothing read"
    for _ in range(attempts):
        marker = fetch(base + "SOURCE_SHA")
        sha = marker.decode("ascii", "replace").strip()
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError(f"SOURCE_SHA does not hold a commit: {sha[:60]!r}")
        facts = fetch(base + "facts.json.gz")
        described = json.loads(gzip.decompress(facts)).get("source_commit")
        if described == sha:
            return {"SOURCE_SHA": marker, "facts.json.gz": facts}
        seen = f"SOURCE_SHA is {sha[:12]} but facts.json.gz describes {str(described)[:12]}"
    raise ValueError(f"the documentation changed between reads {attempts} times: {seen}")


def write(out: Path, pair: dict[str, bytes]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        (out / (name + ".new")).write_bytes(pair[name])
    for name in FILES:
        os.replace(out / (name + ".new"), out / name)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--base", default=DOCS)
    args = ap.parse_args()
    try:
        pair = consistent_pair(args.base)
    except Exception as exc:  # noqa: BLE001 - any failure keeps the previous pair
        sys.exit(f"mirror_docs: {exc}")
    write(args.out, pair)
    print(f"mirror_docs: {pair['SOURCE_SHA'].decode().strip()} ({len(pair['facts.json.gz'])} bytes of facts)")


if __name__ == "__main__":
    main()
