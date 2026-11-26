#!/usr/bin/env python3
"""Build an offline, self-contained atlas using Python's standard library."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from blueprints import add_new_roadmaps, check_new_summaries, drop_source_excerpts, load_promoted, merge_blueprints, replaced_layers, trim_decompositions  # noqa: E402
from decompositions import merge_decompositions, merge_links  # noqa: E402
from galaxies import apply_galaxies  # noqa: E402
from restructure import apply_restructurings, load_accepted  # noqa: E402
from retirements import apply_retirements, load_retirements  # noqa: E402
from library_coverage import already_available, coverage_statuses, load_coverage  # noqa: E402
from artefacts import paper_artefacts  # noqa: E402
from definitions_page import render as definitions_page  # noqa: E402
from tauceti_progress import add_new_roadmaps as add_new_tauceti_roadmaps, apply as apply_tauceti_progress, fit_to_arxiv  # noqa: E402
from tauceti_progress import load as load_tauceti_progress, load_readmes as load_tauceti_readmes, tauceti_only  # noqa: E402
from tauceti_prs import add_proposed, load as load_tauceti_prs  # noqa: E402
from tauceti_progress import REPOSITORY as TAUCETI_BLOB, load_arxiv_areas, matches as tauceti_rows  # noqa: E402
from roadmap_dependencies import add_dependencies, follow_pull_requests  # noqa: E402
from arxiv_groups import UNCLASSIFIED, group_by_arxiv  # noqa: E402
from atlas_distances import measure as measure_page_distances  # noqa: E402
from disk_layout import layout as disk_layout  # noqa: E402
from lazy_data import FOLDER as PARTS_FOLDER, encode as encode_part, inline_part, split as split_lazy, write_parts  # noqa: E402


def load_decompositions() -> list:
    """Reviewed source decompositions promoted under data/decompositions/, in name order."""
    folder = ROOT / "data" / "decompositions"
    if not folder.is_dir():
        return []
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.glob("*.json"))]


def load_disk() -> dict | None:
    """Mathlib's key definitions and theorems for the disk (scripts/mathlib_disk.py), when they have been made."""
    path = ROOT / "data" / "mathlib-disk.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def safe_script(text: str) -> str:
    return re.sub(r"</script", r"<\\/script", text, flags=re.IGNORECASE)


REPOSITORY = "https://github.com/CBirkbeck/tauceti-explorer"


def comment_text(text: str) -> str:
    return text.replace("--", "—")


def derive(atlas: dict) -> tuple[str, dict, dict]:
    """What the page drew and cited from the roadmaps' READMEs and the layers' descriptions when it started (the
    planets, their names, the citations' README lines, each roadmap's bibliography), made here by the page's own
    code (scripts/derive.js), which also checks it against what that code makes of the whole text. The page has
    no README to work from, so this needs Node (ATLAS_NODE, or `node` on the path). Returns the derived data as
    JSON text, as Node wrote it, each roadmap's own bibliography, and each README's words for the search."""
    node = os.environ.get("ATLAS_NODE") or shutil.which("node") or shutil.which("nodejs")
    if not node:
        raise ValueError("The build needs Node to prepare what the page draws from the roadmaps' text (scripts/derive.js); "
                         "put `node` on the path or name it in ATLAS_NODE.")
    with tempfile.TemporaryDirectory(prefix="atlas-derive-") as folder:
        path = Path(folder) / "atlas.json"
        path.write_text(json.dumps(atlas, ensure_ascii=False), encoding="utf-8")
        result = subprocess.run([node, "--max-old-space-size=4096", str(ROOT / "scripts" / "derive.js"), str(path), folder],
                                capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            raise ValueError("scripts/derive.js failed: " + result.stderr.strip()[-2000:])
        read = lambda name: (Path(folder) / name).read_text(encoding="utf-8")
        return read("derived.json"), json.loads(read("bibliographies.json")), json.loads(read("words.json"))


SITE = "https://taucetiproject.org/"


def link_roadmaps(atlas: dict, rows: dict, sources: dict, stale: frozenset = frozenset()) -> dict:
    """Give each roadmap the link the page shows in place of its README, and the address its README's lines are
    cited at. The page no longer carries the README.

    `page`: the roadmap's page on the website, roadmap.html?id=<its row's id on the Progress page>, when the
    Progress page has a row for it (`rows`, scripts/tauceti_progress.py); otherwise its README on GitHub.
    `readmeSource`: the README on GitHub as this build read it (`sources`), which line numbers refer to. For a
    roadmap in `stale`, whose copy here is older than the README on main, it is the README on main, and
    `readmeLines` is false: the copy's line numbers are not that file's, so citations link to the file, not a line.
    A link is given only where this build has seen what it points to: the row, or the README it read at that
    address. Returns how many roadmaps got which."""
    site = os.environ.get("ATLAS_SITE_URL", SITE).rstrip("/") + "/"
    counts = Counter()
    for roadmap in atlas["roadmaps"]:
        source = sources.get(roadmap["id"]) or ""
        github = source if re.match(r"^https://github\.com/[^\s\"<>]+$", source) else None
        pull = (roadmap.get("pull") or {}).get("url") or ""
        if github:
            roadmap["readmeSource"] = github
            if roadmap["id"] in stale:
                roadmap["readmeLines"] = False
        row = rows.get(roadmap["id"])
        if row and row.get("id"):
            roadmap["page"] = {"href": site + "roadmap.html?id=" + quote(row["id"], safe=""), "on": "site"}
        elif github:
            roadmap["page"] = {"href": github, "on": "github"}
        elif re.match(r"^https://github\.com/[^\s\"<>]+/pull/\d+$", pull):
            roadmap["page"] = {"href": pull, "on": "pull"}
        counts[(roadmap.get("page") or {}).get("on", "none")] += 1
    return dict(counts)


def assemble(require_distances: bool = True, blueprints: Path | None = None) -> tuple:
    """The atlas data, checked; and what the build report needs. Raises ValueError on any problem.

    require_distances=False lets a roadmap without a measured distance through at a provisional one:
    promotion tries new work in the build before scripts/measure_distances.py has measured it."""
    atlas = json.loads(read_text("data/atlas.json"))
    # Retired roadmaps (data/roadmap-retirements.json) leave the atlas with
    # their layers and every link through them; overlays for them are ignored.
    retired = load_retirements(ROOT)
    retired_stages = {stage["id"] for stage in atlas["stages"] if stage.get("owner") in retired}
    atlas = apply_retirements(atlas, retired)
    # Reviewed blueprints promoted by scripts/promote.py (data/blueprints/). New
    # roadmaps join first, so that links and refinements can refer to them.
    packets, documents, definitions = load_promoted(ROOT, blueprints)
    classification = json.loads(read_text("data/roadmap-classification.json"))
    clusters = {galaxy["id"]: (galaxy.get("clusters") or [None])[0] for galaxy in json.loads(read_text("data/galaxies.json"))["galaxies"]}
    atlas, classification["roadmaps"] = add_new_roadmaps(atlas, definitions, classification["roadmaps"], clusters)
    # Accepted restructuring proposals (data/restructure/): Part II titles, narrowed and dropped layers, their links.
    atlas, dropped = apply_restructurings(atlas, load_accepted(ROOT))
    # The snapshot stays immutable; reviewed decompositions refine it at build
    # time, so nothing is appended twice and the originals remain the record. A
    # promoted blueprint replaces the decomposition of the layers it covers.
    decompositions = trim_decompositions(load_decompositions(), replaced_layers(packets, {r["id"]: r["stages"] for r in atlas["roadmaps"]}))
    original_stage_count = len(atlas["stages"])
    link_folder = ROOT / "data" / "links"
    link_packets = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(link_folder.glob("*.json"))] if link_folder.is_dir() else []
    for packet in link_packets:
        packet["links"] = [link for link in packet.get("links", [])
                           if link.get("source") not in retired_stages and link.get("target") not in retired_stages]
    if link_packets:
        atlas = merge_links(atlas, link_packets)
    for packet in decompositions:
        # A link through a retired layer is dropped, like any other link to it.
        through = lambda ref: str(ref).split("/")[0] in retired_stages or str(ref) in retired_stages
        for key in ("links", "deferredLinks"):
            if isinstance(packet.get(key), list):
                packet[key] = [link for link in packet[key] if not (through(link.get("source")) or through(link.get("target")))]
    atlas, _expanded_documents = merge_decompositions(atlas, decompositions)
    atlas = merge_blueprints(atlas, packets, documents)
    atlas.setdefault("decompositions", [])
    atlas["meta"]["originalStageCount"] = original_stage_count
    atlas["progress"] = json.loads(read_text("data/status.json"))
    # Stage statuses mapped from the maintained reports (scripts/merge_stage_status.py)
    # sit on top of the imported snapshot; each carries its quoted evidence.
    mapped_path = ROOT / "data/stage-status-reports.json"
    atlas["mappedStageStatuses"] = {k: v for k, v in (json.loads(mapped_path.read_text(encoding="utf-8")) if mapped_path.exists() else {}).items()
                                    if k not in retired_stages}
    for stage_id, entry in atlas["mappedStageStatuses"].items():
        if entry.get("status") not in ("planned", "in_progress", "complete") or not entry.get("evidence"):
            raise ValueError("Mapped stage status needs a known status and evidence: " + stage_id)
    atlas["progress"]["stages"].update(atlas["mappedStageStatuses"])
    # Tau Ceti's own roadmaps take each layer's state from the Tau Ceti site's Progress page
    # (data/tauceti-progress.json, refreshed daily by scripts/tauceti_progress.py --fetch).
    board = load_tauceti_progress()
    if board:
        apply_tauceti_progress(atlas, board)
    # The reviewed library audit marks layers that Mathlib or Tau Ceti already contain.
    coverage = load_coverage(ROOT)
    tauceti_roadmaps = {roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap.get("origin") == "tauceti"}
    atlas["libraryStatuses"] = coverage_statuses(coverage, atlas["progress"]["stages"],
                                                 {stage["id"] for stage in atlas["stages"] if stage.get("owner") in tauceti_roadmaps})
    atlas["progress"]["stages"].update(atlas["libraryStatuses"])
    atlas["libraryCoverage"] = {"reviews": coverage.get("reviews", {}), "pendingReview": coverage.get("pendingReview", []),
                                "layers": {sid: {"verdict": layer["verdict"], "duplicates": layer.get("duplicates", [])}
                                           for sid, layer in coverage.get("layers", {}).items() if sid not in retired_stages}}
    atlas["roadmapClassification"] = classification
    # Roadmaps are grouped into subject galaxies by the classification of their
    # references; the snapshot's own area assignment is superseded.
    subjects = json.loads(read_text("data/galaxies.json"))
    galaxies = subjects["galaxies"]
    # Distances from Mathlib and galaxy directions are measured by
    # scripts/measure_distances.py from the theory graph and the judgements.
    atlas["roadmapDistances"] = json.loads(read_text("data/roadmap-distances.json"))
    atlas["galaxyLayout"] = json.loads(read_text("data/galaxy-layout.json"))
    missing = sorted({roadmap["id"] for roadmap in atlas["roadmaps"]} - set(atlas["roadmapDistances"]["roadmaps"]))
    if missing and require_distances:
        raise ValueError("Roadmaps without a measured distance; run scripts/measure_distances.py: " + ", ".join(missing[:5]))
    for rid in missing:
        estimate = atlas["roadmapClassification"]["roadmaps"].get(rid, {}).get("distance") or 5
        atlas["roadmapDistances"]["roadmaps"][rid] = {"distance": estimate, "basis": "provisional"}
    atlas["regions"] = apply_galaxies(atlas, galaxies, atlas["roadmapClassification"], atlas["roadmapDistances"], atlas["galaxyLayout"],
                                      fields=subjects["fields"])
    atlas["opportunities"] = json.loads(read_text("data/opportunities.json"))
    # Areas without a roadmap are not drawn: the atlas maps roadmaps that exist.
    atlas["opportunities"]["areas"] = []
    atlas["opportunities"]["groups"] = []
    def keep_stage(key):
        return key.split("::landmark:")[0] not in retired_stages
    atlas["stagePresentation"] = {k: v for k, v in json.loads(read_text("data/stage-presentation.json")).items() if keep_stage(k)}
    for stage_id, item in dropped.items():
        atlas["stagePresentation"][stage_id] = {**atlas["stagePresentation"].get(stage_id, {}), **item}
    # A proposed roadmap shows only what still has to be built.
    for stage_id, item in already_available(coverage, atlas).items():
        if keep_stage(stage_id):
            atlas["stagePresentation"][stage_id] = {**atlas["stagePresentation"].get(stage_id, {}), **item}
    # Planet names and hidden planets matter only on layers that are drawn.
    def drawn_stage(key):
        return keep_stage(key) and not atlas["stagePresentation"].get(key.split("::landmark:")[0], {}).get("hidden")
    atlas["landmarkLabels"] = {k: v for k, v in json.loads(read_text("data/landmark-labels.json")).items() if drawn_stage(k)}
    atlas["landmarkHidden"] = {k: v for k, v in json.loads(read_text("data/landmark-hidden.json")).items() if drawn_stage(k)}
    # Edited overview summaries: mathematical prose for readers, keyed by roadmap id.
    atlas["roadmapSummaries"] = {k: v for k, v in json.loads(read_text("data/roadmap-summaries.json")).items() if k not in retired}
    roadmap_ids = {roadmap["id"] for roadmap in atlas["roadmaps"]}
    for roadmap_id, summary in atlas["roadmapSummaries"].items():
        if roadmap_id not in roadmap_ids:
            raise ValueError("Roadmap summary refers to an unknown roadmap: " + roadmap_id)
        if not isinstance(summary, str) or len(summary.split()) < 40:
            raise ValueError("Roadmap summaries are at least forty words of prose: " + roadmap_id)
    for roadmap in atlas["roadmaps"]:
        if roadmap["id"] in atlas["roadmapSummaries"]:
            roadmap["summary"] = atlas["roadmapSummaries"][roadmap["id"]]
    check_new_summaries(atlas["roadmaps"], definitions)
    atlas["bibliography"] = json.loads(read_text("data/bibliography.json"))
    stage_ids = {stage["id"] for stage in atlas["stages"]}
    if set(atlas["stagePresentation"]) - stage_ids:
        raise ValueError("Stage presentation contains an unknown stage ID.")
    for stage_id, item in atlas["stagePresentation"].items():
        if not isinstance(item.get("summary"), str) or not item["summary"].strip():
            raise ValueError("Missing mathematical presentation summary: " + stage_id)
        if "hidden" in item and not isinstance(item["hidden"], bool):
            raise ValueError("Stage visibility must be a boolean: " + stage_id)
        if "title" in item and (not isinstance(item["title"], str) or not item["title"].strip()):
            raise ValueError("Empty mathematical presentation title: " + stage_id)
    for landmark_id, reason in atlas["landmarkHidden"].items():
        if "::landmark:" not in landmark_id or landmark_id.split("::landmark:")[0] not in stage_ids:
            raise ValueError("Hidden planet refers to an unknown stage ID: " + landmark_id)
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Every hidden planet needs a recorded reason: " + landmark_id)
        if landmark_id in atlas["landmarkLabels"]:
            raise ValueError("A planet cannot be both named and hidden: " + landmark_id)
    for landmark_id, label in atlas["landmarkLabels"].items():
        if "::landmark:" not in landmark_id or landmark_id.split("::landmark:")[0] not in stage_ids:
            raise ValueError("Planet label contains an unknown stage ID: " + landmark_id)
        if not isinstance(label, str) or not label.strip() or len(label) > 72 or re.search(r"[\\${}^]", label):
            raise ValueError("Planet labels must be short plain text: " + landmark_id)
    for work in atlas["bibliography"]["works"]:
        if not work.get("title") or not isinstance(work.get("aliases"), list):
            raise ValueError("Bibliographic records need a title and aliases.")
        if work.get("url") and not re.match(r"^https?://", work["url"]):
            raise ValueError("Bibliographic links must be public web addresses.")
    # Papers as artefacts beside the roadmaps they build on, locked until what they need is formalised.
    atlas["papers"] = paper_artefacts(atlas, ROOT / "research" / "blueprint" / "papers")
    roadmap_ids = {roadmap["id"] for roadmap in atlas["roadmaps"]}
    for paper in atlas["papers"]:
        if paper["home"] not in roadmap_ids or set(paper["roadmaps"]) - roadmap_ids or set(paper["needs"]) - stage_ids:
            raise ValueError("A paper artefact refers to something not in the atlas: " + paper["id"])
        if paper["link"] and not re.match(r"^https?://", paper["link"]):
            raise ValueError("Paper links must be public web addresses: " + paper["id"])
    # Complete roadmaps in Tau Ceti's own form, as published in roadmaps/<Name>/ (research/blueprint/PROTOCOL.md section 20).
    ids = {roadmap["id"] for roadmap in atlas["roadmaps"]}
    atlas["packages"] = {folder.name: {"readme": f"{REPOSITORY}/blob/main/roadmaps/{folder.name}/README.md",
                                       "lean": f"{REPOSITORY}/blob/main/roadmaps/{folder.name}/Suggested.lean"}
                         for folder in sorted((ROOT / "roadmaps").glob("*")) if (folder / "README.md").exists() and folder.name in ids}
    return atlas, {"retired": retired, "linkPackets": link_packets, "originalStageCount": original_stage_count, "blueprints": packets}


def build(output: Path, blueprints: Path | None = None, variant: str | None = None, self_contained: bool = False) -> dict:
    # Only the campaign's own map shows the distances of its planned roadmaps; the published pages do not need them.
    atlas, context = assemble(require_distances=variant == "campaign", blueprints=blueprints)
    # Roadmaps Tau Ceti has accepted since the snapshot join the map from their READMEs, so each
    # one counts in the layers (and lowers the share complete) from the day the Progress page lists it.
    board, added = load_tauceti_progress(), []
    if board:
        added = add_new_tauceti_roadmaps(atlas, board, load_tauceti_readmes())
        if added:
            apply_tauceti_progress(atlas, board)
        # Each Tau Ceti roadmap declares an arXiv category; it sits in an area that category allows.
        fit_to_arxiv(atlas, board)
    # The key definitions page lists what the explorer's own surveys found (research/blueprint/PROTOCOL.md, section 19).
    listing = definitions_page(atlas, ROOT) if variant is None else None
    if variant in (None, "tauceti"):
        # The Tau Ceti build: only the roadmaps Tau Ceti's Progress page reports.
        atlas = tauceti_only(atlas)
        # The live galaxy (src/live.js): the page asks GitHub for Tau Ceti's open pull requests and shows
        # each beside the roadmaps its `roadmap/<Name>` labels name.
        atlas["live"] = {"repo": "TauCetiProject/TauCeti", "labelPrefix": "roadmap/", "idPrefix": "tauceti:TauCetiRoadmap/"}
    if variant is None:
        # The atlas (since 2026-10-21): Tau Ceti's roadmaps and every roadmap an open pull request to TauCetiRoadmap
        # proposes, whoever opened it. The explorer's own planned roadmaps are the "campaign" build, not published.
        atlas["variant"] = "atlas"
        proposals = load_tauceti_prs() or {"pulls": [], "roadmaps": {}, "openPulls": 0}
        # The map groups by arXiv category below, so a proposal no area rule places still joins it.
        proposed = add_proposed(atlas, proposals, fallback=UNCLASSIFIED)
        owners = set(proposed)
        layers = sum(1 for stage in atlas["stages"] if stage["owner"] in owners)
        # Proposed layers count as not started: the headline is the share done of Tau Ceti's and the proposed layers.
        counts = atlas["taucetiProgress"]["counts"]
        counts["proposed"], counts["total"] = layers, counts["total"] + layers
        atlas["proposals"] = {"repository": "TauCetiProject/TauCetiRoadmap", "openPulls": proposals.get("openPulls", 0),
                              "pulls": len({roadmap["pull"]["number"] for roadmap in atlas["roadmaps"] if roadmap["id"] in owners}),
                              "roadmaps": proposed, "layers": layers,
                              "unplaced": sorted("tauceti:" + folder for folder in proposals["roadmaps"] if "tauceti:" + folder not in owners),
                              "updatedAt": max((pull["updatedAt"] for pull in proposals["pulls"]), default=None)}
    if variant in (None, "tauceti"):
        # The roadmaps each README says it builds on become prerequisite links, and the published pages group
        # the roadmaps by the arXiv category each declares (scripts/arxiv_groups.py), not by the campaign's areas.
        folder = lambda roadmap_id: roadmap_id.split(":", 1)[1]
        rows = tauceti_rows(atlas, board or {})

        def address(roadmap):
            """The README as the atlas read it, so a line number points at the right line: main's when the copy is
            current, else the snapshot's commit."""
            current = hashlib.sha256(roadmap["readme"].encode("utf-8")).hexdigest() == rows.get(roadmap["id"], {}).get("readme_sha")
            head, path = (roadmap.get("statusSnapshot") or {}).get("head"), roadmap.get("repositoryPath") or ""
            if not current and head and path and not path.startswith("http"):
                return f"https://github.com/TauCetiProject/TauCetiRoadmap/blob/{head}/{path}"
            return TAUCETI_BLOB + folder(roadmap["id"]) + "/README.md"
        readmes = {r["id"]: (r["readme"], folder(r["id"]), address(r)) for r in atlas["roadmaps"] if r.get("origin") == "tauceti" and r.get("readme")}
        # Every row of the board declares a category, those of folders that are not on the map (an umbrella) included.
        declared = {"tauceti:" + row["id"]: row.get("arxiv") for row in (board or {}).get("rows", [])}
        declared.update({roadmap_id: row.get("arxiv") for roadmap_id, row in rows.items()})
        if variant is None:
            # A proposed roadmap's README is read from the pull request's branch; the page keeps only its address.
            for r in atlas["roadmaps"]:
                entry = proposals["roadmaps"].get(folder(r["id"])) if r.get("origin") == "proposed" else None
                if entry:
                    readmes[r["id"]] = (entry.get("readme") or "", folder(r["id"]), r.get("sourcePath") or "")
                    declared[r["id"]] = entry.get("arxiv")
        atlas["meta"]["readmePrerequisites"] = add_dependencies(atlas, readmes)
        # In place of each README, which the page no longer carries: a link to the roadmap's page on the website.
        # A Tau Ceti README read from the snapshot's working tree, which main has since changed, is cited on main: the
        # snapshot's commit is not on GitHub, so its own address leads nowhere. One with no row to say where it is on
        # main is not cited at all.
        on_main = {roadmap_id: TAUCETI_BLOB + rows[roadmap_id]["readme"] for roadmap_id in readmes if (rows.get(roadmap_id) or {}).get("readme")}
        proposed = {roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap.get("origin") == "proposed"}
        stale = frozenset(roadmap_id for roadmap_id, entry in readmes.items() if roadmap_id in on_main and roadmap_id not in proposed and not entry[2].startswith(TAUCETI_BLOB))
        sources = {roadmap_id: on_main[roadmap_id] if roadmap_id in stale else entry[2] for roadmap_id, entry in readmes.items()
                   if roadmap_id in stale or roadmap_id in proposed or entry[2].startswith(TAUCETI_BLOB)}
        atlas["meta"]["roadmapPages"] = link_roadmaps(atlas, rows, sources, stale)
        if variant is None:
            # The prerequisites a pull request's description states outrank its README's.
            atlas["meta"]["pullPrerequisites"] = follow_pull_requests(atlas, proposals["pulls"])
        # Every roadmap on the page lies as far from Mathlib as the work in the roadmaps it rests on (scripts/atlas_distances.py).
        distances = atlas["roadmapDistances"]
        distances["roadmaps"] = measure_page_distances(atlas)
        distances["bases"] = dict(Counter(entry["basis"] for entry in distances["roadmaps"].values()))
        distances["method"] = {"distance": "A roadmap's distance from Mathlib is the work still to do in the roadmaps it rests on: every roadmap "
                               "its README or its pull request names as a prerequisite, every roadmap those rest on, and itself, each counting "
                               "the share of its layers not yet done. It is placed on a 0-10 scale in proportion, 10 being the farthest roadmap on the page."}
        # The Mathlib disk, round the sun (scripts/disk_layout.py): its areas are on the map even where no roadmap is yet.
        disk = load_disk()
        also = frozenset(area.split("/")[0] for area in (disk or {}).get("areas", {}) if area)
        # One division for the disk and the map: the sectors share the circle between the roadmaps and Mathlib's items.
        atlas["meta"]["arxivGroups"] = group_by_arxiv(atlas, declared, load_arxiv_areas(), json.loads(read_text("data/arxiv-subareas.json")), also=also,
                                                      mathlib={area: entry["items"] for area, entry in disk["areas"].items()} if disk else None)
        if disk:
            atlas["mathlibDisk"] = disk_layout(disk, atlas["groups"])
    retired, link_packets = context["retired"], context["linkPackets"]
    # Layers that are not source refinements: the snapshot's, and those of any roadmap added above.
    original_stage_count = sum(1 for stage in atlas["stages"] if not stage.get("expansion"))
    atlas["meta"]["originalStageCount"] = original_stage_count
    assets = {
        "D3": "vendor/d3.v5.15.0.min.js",
        "KATEX": "vendor/katex.v0.16.28.min.js",
        "MARKDOWN": "src/markdown.js",
        "UNIVERSE": "src/universe.js",
        "GRAPH": "src/graph.js",
        "CAMERA": "src/camera.js",
        "PROGRESS": "src/progress.js",
        "LANDMARKS": "src/landmarks.js",
        "PRESENTATION": "src/presentation.js",
        "LAZY": "src/lazy.js",
        "REFERENCES": "src/references.js",
        "LIVE": "src/live.js",
        "APP": "src/app.js",
    }
    style_paths = ["src/style.css"]
    if (ROOT / "src/voyager.css").exists():
        style_paths.append("src/voyager.css")
    page = read_text("src/shell.html")
    styles = "\n".join(read_text(path) for path in style_paths)
    if re.search(r"</style", styles, re.IGNORECASE):
        raise ValueError("Stylesheets must not contain a closing HTML style tag.")
    page = page.replace("/*__STYLE__*/", styles)
    for tag, path in assets.items():
        marker = "/*__" + tag + "__*/"
        if marker not in page:
            raise ValueError("Missing template marker: " + marker)
        page = page.replace(marker, safe_script(read_text(path)))
    # The page quotes no source: a citation carries its locator, never a passage (PROTOCOL.md section 5).
    # The page carries the core of the data. The roadmaps' READMEs are not in it: the page links to each roadmap
    # instead (link_roadmaps), and what it drew from them comes ready-made (derive). The rest of the long text is
    # in parts beside the page (scripts/lazy_data.py), which it reads when a panel needs them. --self-contained
    # writes the parts into the page instead, as the page's own offline copy does.
    published = drop_source_excerpts(atlas)
    derived, bibliographies, words = derive(published)
    published["roadmaps"] = [{key: value for key, value in roadmap.items() if key != "readme"} for roadmap in published["roadmaps"]]
    published["roadmapBibliographies"] = bibliographies
    published["readmeWords"] = words
    core, parts = split_lazy(published)
    for name, part in parts.items():
        if re.search(r"/(?:Users|home)/[^/\s]+/", encode_part(part)):
            raise ValueError("An absolute home directory remains in the public atlas: " + name)
    parts_folder = output.parent / PARTS_FOLDER
    if self_contained:
        if parts_folder.exists():
            shutil.rmtree(parts_folder)
        core["lazy"]["parts"] = {name: [None, len(encode_part(part).encode("utf-8"))] for name, part in parts.items()}
        marker = '<script id="atlas-data"'
        if page.count(marker) != 1:
            raise ValueError("The data element must appear once in the template.")
        page = page.replace(marker, "".join(inline_part(name, parts[name]) for name in sorted(parts)) + marker)
    else:
        core["lazy"]["parts"] = write_parts(parts_folder, parts)
    payload = json.dumps(core, ensure_ascii=False, separators=(",", ":"))
    # Node's own text, not re-read here: an excerpt cut inside a character pair is not text Python can write.
    payload = payload[:-1] + ',"derived":' + derived + "}"
    payload = payload.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    if "/*__DATA__*/" not in page:
        raise ValueError("Missing data template marker.")
    page = page.replace("/*__DATA__*/", payload)
    if re.search(r"/\*__[A-Z_]+__\*/", page):
        raise ValueError("An unresolved build marker remains in the page.")
    # Set initial counters too, so they agree with the data before app startup.
    for element_id, count in (("roadmap-total", len(atlas["roadmaps"])), ("stage-total", len(atlas["stages"]))):
        page = re.sub(r'(<b id="' + element_id + r'">)[^<]*(</b>)', lambda match: match[1] + f"{count:,}" + match[2], page)
    notices = "\n\n".join(read_text(path) for path in ("NOTICE", "LICENSE", "vendor/D3-LICENSE.txt", "vendor/KaTeX-LICENSE.txt"))
    page = page.replace("</head>", "<!--\n" + comment_text(notices) + "\n-->\n</head>", 1)
    if re.search(r"<(?:script|link)\b[^>]*(?:src|href)\s*=\s*['\"]https?://", page, re.IGNORECASE):
        raise ValueError("An external runtime asset would prevent a self-contained build.")
    if re.search(r"/(?:Users|home)/[^/\s]+/", page):
        raise ValueError("An absolute home directory remains in the public atlas.")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    if listing is not None:
        # The key definitions as one plain list page, for sharing (research/blueprint/PROTOCOL.md, section 19).
        if re.search(r"/(?:Users|home)/[^/\s]+/", listing):
            raise ValueError("An absolute home directory remains in the definitions page.")
        (output.parent / "definitions.html").write_text(listing, encoding="utf-8")
    # Refinements are planning detail under their parent layer: they are not
    # progress targets, so the parent stays terminal for progress accounting.
    refinements = [stage for stage in atlas["stages"] if stage.get("expansion")]
    parent_ids = {stage.get("parentStageId") for stage in atlas["stages"] if stage.get("parentStageId") and not stage.get("expansion")}
    source_paths = ["src/shell.html", *style_paths, *assets.values(), "data/atlas.json", "data/status.json", "data/tauceti-progress.json", "data/tauceti-new-roadmaps.json", "data/galaxies.json", "data/roadmap-retirements.json", "data/library-coverage.json", "data/opportunities.json", "data/stage-presentation.json", "data/landmark-labels.json", "data/landmark-hidden.json", "data/roadmap-summaries.json", "data/roadmap-classification.json", "data/classification-estimates.json", "data/roadmap-distances.json", "data/galaxy-layout.json", "data/bibliography.json", *(["data/mathlib-disk.json"] if (ROOT / "data/mathlib-disk.json").exists() else []), "NOTICE", "LICENSE", "vendor/D3-LICENSE.txt", "vendor/KaTeX-LICENSE.txt"]
    for folder in ("data/decompositions", "data/blueprints", "data/blueprints/roadmaps", "data/links", "data/restructure"):
        source_paths += [str(path.relative_to(ROOT)) for path in sorted((ROOT / folder).glob("*.*"))] if (ROOT / folder).is_dir() else []
    report = {
        "roadmaps": len(atlas["roadmaps"]),
        "stages": len(atlas["stages"]),
        "originalStages": original_stage_count,
        "sourceRefinements": len(refinements),
        "reviewedDecompositions": [{"roadmap": item["roadmapId"], "status": item["status"], "nodes": item["nodes"],
                                    "review": item["review"]["status"], "deferredLinks": len(item.get("deferredLinks", []))}
                                   for item in atlas["decompositions"]],
        "terminalTargets": sum(stage["id"] not in parent_ids and not stage.get("expansion") for stage in atlas["stages"]),
        "groups": len(atlas["groups"]),
        "retiredRoadmaps": sorted(retired),
        "classifiedRoadmaps": atlas["roadmapClassification"]["counts"]["classified"],
        "estimatedRoadmaps": atlas["roadmapClassification"]["counts"]["estimated"],
        "distanceBases": atlas["roadmapDistances"]["bases"],
        "pairwiseJudgements": atlas["roadmapDistances"]["pairwise"]["judgements"],
        "unmappedAreas": len(atlas["opportunities"]["areas"]),
        "areasWithRoadmaps": sum(1 for group in atlas["groups"] + atlas["opportunities"]["groups"] if any(roadmap.get("group") == group["id"] for roadmap in atlas["roadmaps"])),
        "additionalRegions": len(atlas["opportunities"]["groups"]),
        "mathematicalSummaries": len(atlas["roadmaps"]),
        "editedRoadmapSummaries": len(atlas["roadmapSummaries"]),
        "curatedStagePresentations": len(atlas["stagePresentation"]),
        "administrativeStages": sum(bool(item.get("hidden")) for item in atlas["stagePresentation"].values()),
        "mathematicalStars": sum(not atlas["stagePresentation"].get(stage["id"], {}).get("hidden") for stage in atlas["stages"]),
        "plainTextPlanetLabels": len(atlas["landmarkLabels"]),
        "hiddenPlanets": len(atlas["landmarkHidden"]),
        "mappedStageStatuses": len(atlas["mappedStageStatuses"]),
        "libraryAuditStatuses": len(atlas["libraryStatuses"]),
        "bibliographicSources": len(atlas["bibliography"]["works"]),
        "roadmapEdges": len(atlas["edges"]),
        "stageEdges": len(atlas["stageEdges"]),
        "reviewedLinkPackets": len(link_packets),
        "promotedBlueprints": [{"file": stem, "roadmap": packet["roadmapId"], "nodes": len(packet.get("nodes", [])),
                                "reviewer": (packet.get("review") or {}).get("reviewer")} for stem, packet in context["blueprints"]],
        "sourceDocuments": sum(1 for _ in (ROOT / "content").rglob("*.md")),
        "htmlBytes": output.stat().st_size,
        "dataParts": {"count": len(parts), "bytes": sum(size for _file, size in core["lazy"]["parts"].values()),
                      "folder": None if self_contained else PARTS_FOLDER, "derivedBytes": len(derived.encode("utf-8"))},
        "roadmapPages": atlas["meta"].get("roadmapPages", {}),
        "htmlSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "networkDependencies": 0,
        "localProgressOverridesIncluded": False,
        "assets": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in source_paths},
    }
    if atlas.get("taucetiProgress"):
        report["taucetiProgress"] = {"exportedAt": atlas["taucetiProgress"]["exportedAt"], "roadmaps": len(atlas["taucetiProgress"]["roadmaps"]),
                                     "unplaced": len(atlas["taucetiProgress"]["unplaced"]), "layers": atlas["taucetiProgress"]["counts"], "added": added,
                                     "readmeLayers": atlas["taucetiProgress"]["readmeLayers"]}
    if atlas.get("proposals"):
        report["proposals"] = {key: atlas["proposals"][key] for key in ("openPulls", "pulls", "layers", "unplaced", "updatedAt")}
        report["proposals"]["roadmaps"] = len(atlas["proposals"]["roadmaps"])
    report["variant"] = variant or "atlas"
    (output.parent / "BUILD.json" if variant else ROOT / "BUILD.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if variant == "tauceti":
        # The areas as the map draws them, for the website's Roadmaps page, which groups by them too.
        areas = [{"id": g["id"], "label": g["label"], "short": g.get("short"), "arxiv": g.get("arxiv"), "area": g.get("area"),
                  "roadmaps": [rid.removeprefix("tauceti:") for rid in g["roadmapIds"]]} for g in atlas["groups"]]
        fields = [{"id": f["id"], "label": f["label"], "areas": f["groupIds"]} for f in atlas.get("fields", [])]
        (output.parent / "areas.json").write_text(json.dumps({"areas": areas, "fields": fields}, indent=1) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "index.html", help="HTML output path; defaults to the repository's index.html")
    parser.add_argument("--blueprints", type=Path, help="read promoted blueprints from this folder instead of data/blueprints (tests)")
    parser.add_argument("--tauceti", action="store_true", help="build the Tau Ceti atlas (tauceti/index.html): only the roadmaps Tau Ceti's Progress page reports")
    parser.add_argument("--campaign", action="store_true", help="build the explorer's own planned map (campaign/index.html, not published) "
                                                                 "with its blueprints, papers and links")
    parser.add_argument("--self-contained", action="store_true", help="write the page's long text into the page itself, as its offline copy "
                                                                       "carries it, rather than into the atlas-data folder beside it")
    arguments = parser.parse_args()
    variant = "tauceti" if arguments.tauceti else "campaign" if arguments.campaign else None
    output = arguments.output if arguments.output != ROOT / "index.html" or variant is None else ROOT / variant / "index.html"
    print(json.dumps(build(output.resolve(), arguments.blueprints, variant, arguments.self_contained), indent=2))


if __name__ == "__main__":
    main()
