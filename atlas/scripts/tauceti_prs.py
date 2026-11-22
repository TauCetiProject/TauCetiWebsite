#!/usr/bin/env python3
"""Roadmaps proposed to Tau Ceti: each roadmap an open pull request to TauCetiProject/TauCetiRoadmap adds.

The atlas shows Tau Ceti's roadmaps (scripts/tauceti_progress.py) and, beside them, every roadmap an
open pull request adds, whoever opened it. Each is read from the README on the pull request's branch,
as a roadmap the Progress page lists without layers is: its layers from its headings, its area from
its arXiv category (metadata.toml) and the roadmaps it names. A README without layers above other roadmaps
is a family's index, and joins as a collection, as families on main do. A pull request that only edits a roadmap
already on main adds nothing here; the edit shows once it merges. Where two pull requests add the same
roadmap, the one updated last is shown.

This module keeps a copy (data/tauceti-prs.json): the pull requests, with the commit each points to, and
for each roadmap they add its arXiv category. The READMEs themselves are large (57 MB on 2026-10-21) and
change with every push, so they stay out of the repository, in a cache keyed by that commit
(data/tauceti-prs-readmes.json), and the page carries each roadmap's layers but reads its README from
GitHub when it is opened. A build fails rather than drop proposals whose READMEs are not cached.

A pull request opened with Tau Ceti's roadmap tooling states its prerequisites in its description, in a
merge-order block: every open pull request that must merge before it, and which of those add roadmaps its
README cites. The copy keeps both (`stated`), and the atlas holds the README's prerequisites to them
(scripts/roadmap_dependencies.py, follow_pull_requests).

Usage: tauceti_prs.py --fetch   list the open pull requests (with gh) and download their roadmaps
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from tauceti_progress import add_new_roadmaps, area_for, short_name

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "TauCetiProject/TauCetiRoadmap"
COPY = ROOT / "data" / "tauceti-prs.json"
CACHE = ROOT / "data" / "tauceti-prs-readmes.json"
RAW = "https://raw.githubusercontent.com/"
# A roadmap is a folder of TauCetiRoadmap/ with a README, possibly inside another roadmap's folder.
README = re.compile(r"^(TauCetiRoadmap/(?:[^/]+/)*[^/]+)/README\.md$")
QUERY = """query($cursor: String) { repository(owner: "TauCetiProject", name: "TauCetiRoadmap") {
  pullRequests(states: OPEN, first: 40, after: $cursor) { pageInfo { hasNextPage endCursor }
    nodes { number title url isDraft createdAt updatedAt body author { login } labels(first: 20) { nodes { name } }
      headRefOid headRepository { nameWithOwner } files(first: 100) { nodes { path changeType } } } } } }"""


def open_pulls(run=None) -> list:
    """Every open pull request, with the files it changes (GitHub's GraphQL API, through gh)."""
    run = run or (lambda args: subprocess.run(args, capture_output=True, text=True, check=True).stdout)
    pulls, cursor = [], None
    while True:
        page = json.loads(run(["gh", "api", "graphql", "-f", "query=" + QUERY] + (["-f", f"cursor={cursor}"] if cursor else [])))
        found = page["data"]["repository"]["pullRequests"]
        pulls += found["nodes"]
        if not found["pageInfo"]["hasNextPage"]:
            return pulls
        cursor = found["pageInfo"]["endCursor"]


def proposed(pulls: list, on_main: set) -> dict:
    """Roadmap folder -> the pull request that adds it: a README the pull request adds, in a folder main does
    not have; of two pull requests adding one roadmap, the one updated last."""
    chosen = {}
    for pull in pulls:
        for item in pull["files"]["nodes"]:
            found = README.match(item["path"])
            if not found or item["changeType"] != "ADDED" or found.group(1) in on_main:
                continue
            folder = found.group(1)
            if folder not in chosen or pull["updatedAt"] > chosen[folder]["updatedAt"]:
                chosen[folder] = pull
    return chosen


MERGE_ORDER = re.compile(r"<!-- merge-order -->(.*?)<!-- /merge-order -->", re.S)
DEPENDENCIES = re.compile(r"^Dependencies\b.*?(?=\n\s*\n|\Z)", re.M | re.S)
# A sentence that names the pull requests whose roadmaps this one cites: its author's own ("In open pull requests of
# ours: #848 (ComplexComparisonPartII), ...") and other authors' ("It also depends on other authors' pull requests
# that add roadmaps it cites, which must merge first: #1104.").
CITING = re.compile(r"in open (?:roadmap )?pull requests|other authors?(?:'s?|’s?)|another author", re.I)


def stated(body: str, number: int) -> dict | None:
    """The prerequisites a pull request's description states, if it has a merge-order block: `before`, every open pull
    request the block says must merge first, and `prerequisites`, those that add roadmaps its README cites."""
    block = MERGE_ORDER.search(body or "")
    if not block:
        return None
    cited = set()
    for paragraph in [block.group(1)] + DEPENDENCIES.findall(body):
        for sentence in re.split(r"(?<=\.)\s+", paragraph):
            if CITING.search(sentence):
                cited.update(int(n) for n in re.findall(r"#(\d+)", sentence))
    return {"before": sorted({int(n) for n in re.findall(r"#(\d+)", block.group(1))} - {number}), "prerequisites": sorted(cited - {number})}


def arxiv(metadata: str) -> str | None:
    """The arXiv category a roadmap's metadata.toml declares as its topic, if any."""
    import tomllib  # Python 3.11; only fetching needs it, so the build runs on older Pythons
    try:
        topic = tomllib.loads(metadata).get("topic")
    except tomllib.TOMLDecodeError:
        return None
    return topic if isinstance(topic, str) else None


def raw(pull: dict, path: str) -> str | None:
    """A file on the pull request's branch, at the commit it points to; None if it has none."""
    url = f"{RAW}{pull['headRepository']['nameWithOwner']}/{pull['headRefOid']}/{path}"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.read().decode("utf-8")
    except OSError:
        return None


def cached(pull: dict, folder: str) -> str:
    """A README's key in the cache: the branch and commit it was read at, and its folder."""
    return f"{pull['head']}@{pull['sha']}/{folder}"


def fetch(copy: Path = COPY, cache: Path = CACHE, board: Path = ROOT / "data" / "tauceti-progress.json") -> dict:
    """Download the open pull requests' roadmaps into the copy and their READMEs into the cache; the roadmaps
    on main are the Progress page's."""
    rows = json.loads(board.read_text(encoding="utf-8")).get("rows", []) if board.exists() else []
    on_main = {row["id"] for row in rows}
    pulls = [pull for pull in open_pulls() if pull.get("headRepository")]
    readmes = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    roadmaps, kept = {}, {}
    for folder, pull in sorted(proposed(pulls, on_main).items()):
        key = cached({"head": pull["headRepository"]["nameWithOwner"], "sha": pull["headRefOid"]}, folder)
        readme = readmes.get(key) or raw(pull, folder + "/README.md")
        if readme is None:
            continue
        kept[key] = readme
        roadmaps[folder] = {"pull": pull["number"], "arxiv": arxiv(raw(pull, folder + "/metadata.toml") or "")}
    shown = {entry["pull"] for entry in roadmaps.values()}
    data = {"repository": REPOSITORY, "pulls": [{"number": pull["number"], "title": pull["title"], "url": pull["url"],
                                                 "author": (pull.get("author") or {}).get("login"), "draft": pull["isDraft"],
                                                 "labels": sorted(label["name"] for label in pull["labels"]["nodes"]),
                                                 "head": pull["headRepository"]["nameWithOwner"], "sha": pull["headRefOid"],
                                                 "createdAt": pull["createdAt"], "updatedAt": pull["updatedAt"],
                                                 **({"stated": said} if (said := stated(pull.get("body"), pull["number"])) else {})}
                                                for pull in sorted(pulls, key=lambda pull: pull["number"]) if pull["number"] in shown],
            "openPulls": len(pulls), "roadmaps": roadmaps}
    copy.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    cache.write_text(json.dumps(kept, ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def load(copy: Path = COPY, cache: Path = CACHE) -> dict | None:
    """The copy, each roadmap with its README from the cache; raises if a README is missing, since a page built
    without it would drop the roadmap (run --fetch first)."""
    if not copy.exists():
        return None
    data = json.loads(copy.read_text(encoding="utf-8"))
    readmes = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    pulls = {pull["number"]: pull for pull in data.get("pulls", [])}
    missing = []
    for folder, entry in data.get("roadmaps", {}).items():
        entry["readme"] = readmes.get(cached(pulls[entry["pull"]], folder)) if entry["pull"] in pulls else None
        if entry["readme"] is None:
            missing.append(folder)
    if missing:
        raise ValueError(f"{len(missing)} proposed roadmaps' READMEs are not in {cache.name}, e.g. {missing[0]}: "
                         "run scripts/tauceti_prs.py --fetch first")
    return data


def add_proposed(atlas: dict, data: dict, placements: dict | None = None, categories: dict | None = None,
                 fallback: str | None = None) -> list:
    """Add each roadmap an open pull request proposes, as tauceti_progress.add_new_roadmaps adds one Tau Ceti has
    accepted, but from the README on the pull request's branch: its layers unassessed, its area, and the roadmaps
    it names, proposed ones included. They have the origin "proposed" and their pull request. Returns the ids added.
    With `fallback`, a roadmap no rule places goes there instead of waiting off the map. A family's index, a README
    without layers in the folder above roadmaps on the map, is a collection: it has no layers of its own."""
    pulls = {pull["number"]: pull for pull in data.get("pulls", [])}
    roadmaps = data.get("roadmaps", {})
    on_map = {roadmap["id"] for roadmap in atlas["roadmaps"]}
    rows, readmes = [], {}
    for folder, entry in sorted(roadmaps.items()):
        pull = pulls.get(entry["pull"])
        if not pull:
            continue
        parent = folder.rsplit("/", 1)[0]
        rows.append({"id": folder, "title": short_name(folder), "arxiv": entry.get("arxiv"), "layer_ids": [], "layers": [], "states": [],
                     # The README on the branch, where its relative links resolve too.
                     "readme": f"https://github.com/{pull['head']}/blob/{pull['sha']}/{folder}/README.md",
                     "parent_id": parent if "tauceti:" + parent in on_map or parent in roadmaps else None})
        readmes[folder] = entry["readme"]
    added = add_new_roadmaps(atlas, {"rows": rows}, readmes, placements, categories, fallback)
    # A roadmap added earlier could link only to those before it: with all of them on the map, link each to
    # every roadmap its README names.
    by_id = {roadmap["id"]: roadmap for roadmap in atlas["roadmaps"]}
    ids = set(added)
    atlas["roadmapLinks"] = [link for link in atlas.get("roadmapLinks", []) if link.get("source") not in ids]
    for roadmap_id in added:
        roadmap = by_id[roadmap_id]
        _, named, _ = area_for(roadmap["readme"], roadmap["title"], atlas, short_name(roadmap_id))
        atlas["roadmapLinks"].extend({"source": roadmap_id, "target": other, "kind": "reference", "label": short_name(other), "anchor": ""}
                                     for other in named)
    for roadmap_id in added:
        folder = roadmap_id.replace("tauceti:", "", 1)
        pull = pulls[roadmaps[folder]["pull"]]
        # The page reads the README from the branch when it is opened (src/app.js, openReader): READMEs are large.
        by_id[roadmap_id].update(origin="proposed", readme="", readmeUrl=f"{RAW}{pull['head']}/{pull['sha']}/{folder}/README.md",
                                 pull={key: pull[key] for key in ("number", "url", "author", "draft", "labels")})
    layers = set()
    for stage in atlas["stages"]:
        if stage["owner"] in ids:
            stage["origin"] = "proposed"
            layers.add(stage["id"])
    for edge in atlas.get("stageEdges", []):
        if edge["source"] in layers:
            edge["origin"] = "proposed"
    return added


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fetch", action="store_true", help="download the open pull requests' roadmaps")
    args = parser.parse_args()
    if args.fetch:
        data = fetch()
        print(f"{len(data['roadmaps'])} roadmaps proposed in {len(data['pulls'])} of the {data['openPulls']} open pull requests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
