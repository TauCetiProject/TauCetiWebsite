"""Split the atlas data into the core the first render needs and the parts the page reads later.

The page used to carry everything in one inline blob, most of it text no first render reads. The roadmaps'
READMEs are no longer in the atlas at all (scripts/build.py links to each roadmap's page instead, and
scripts/derive.js keeps what the page drew from them). `split` takes the rest of the long text out of the
data: every layer's description, each roadmap's bibliography, the evidence of each link and the statements of
Mathlib's items. It groups
them into parts; `write_parts` writes each part beside the page as a script the page loads when it needs it
(src/lazy.js), under a name that carries its content's hash; `join` puts them back, and is what the tests
check the split against.

A part is JSON:
  {"t": {roadmap id: [[stage id, description], ...]},              the layers' descriptions, by roadmap
   "b": {roadmap id: [[citation, README line], ...]},              the roadmaps' own bibliographies
   "e": [[index, evidence], ...], "se": [[index, evidence], ...],  links' evidence
   "d": [[index, {"sig": ..., "doc": ...}], ...],                  the Mathlib disk's statements
   "k": {roadmap id: words}}                                       the READMEs' words, for the search

The text parts are filled by a hash of the roadmap's id, so that a roadmap stays in its part from one build
to the next, and a part whose roadmaps did not change keeps its name and stays in the reader's cache.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

FOLDER = "atlas-data"
TEXT_PARTS = 32
CALLBACK = "TauAtlasPart"
INLINE_ATTRIBUTE = "data-atlas-part"


def text_part(roadmap_id: str) -> str:
    return "text-%02d" % (int.from_bytes(hashlib.sha1(roadmap_id.encode("utf-8")).digest()[:4], "big") % TEXT_PARTS)


def _roots(stages: list) -> dict:
    """Each stage's family: the id of the topmost ancestor its parent links reach."""
    parents = {stage["id"]: stage.get("parentStageId") for stage in stages}
    roots = {}
    for stage_id in parents:
        seen, at = set(), stage_id
        while parents.get(at) in parents and at not in seen:
            seen.add(at)
            at = parents[at]
        roots[stage_id] = at
    return roots


def split(atlas: dict) -> tuple[dict, dict]:
    """The core, and the parts by name. The atlas itself is left as it was; the core shares what it does not change."""
    core = dict(atlas)
    parts: dict = {}
    roadmap_part: dict = {}

    def entry(roadmap_id: str) -> list:
        name = roadmap_part.setdefault(roadmap_id, text_part(roadmap_id))
        return parts.setdefault(name, {"t": {}})["t"].setdefault(roadmap_id, [])

    known = {roadmap["id"] for roadmap in atlas.get("roadmaps", [])}
    # The page reads a layer with its sub-layers (src/landmarks.js, scope), so a family whose layers belong to
    # different roadmaps would be read with a part missing: such a family stays in the core.
    stages = atlas.get("stages", [])
    roots, owners = _roots(stages), {}
    for stage in stages:
        owners.setdefault(roots[stage["id"]], set()).add(stage.get("owner"))
    core["stages"] = []
    for stage in stages:
        owner, description = stage.get("owner"), stage.get("description")
        if isinstance(description, str) and description and owner in known and len(owners[roots[stage["id"]]]) == 1:
            entry(owner).append([stage["id"], description])
            stage = {key: value for key, value in stage.items() if key != "description"}
        core["stages"].append(stage)
    # A roadmap's own bibliography (scripts/derive.js) is read with its layers, when a planet's panel opens.
    if isinstance(atlas.get("roadmapBibliographies"), dict):
        for roadmap_id, rows in core.pop("roadmapBibliographies").items():
            if rows and roadmap_id in known:
                entry(roadmap_id)
                parts[roadmap_part[roadmap_id]].setdefault("b", {})[roadmap_id] = rows
    links: dict = {}
    for key, short in (("edges", "e"), ("stageEdges", "se")):
        if not isinstance(atlas.get(key), list):
            continue
        core[key] = []
        for index, edge in enumerate(atlas[key]):
            if edge.get("evidence"):
                links.setdefault(short, []).append([index, edge["evidence"]])
                edge = {name: value for name, value in edge.items() if name != "evidence"}
            core[key].append(edge)
    if links:
        parts["links"] = links
    disk = atlas.get("mathlibDisk")
    if isinstance(disk, dict) and isinstance(disk.get("items"), list):
        rows, items = [], []
        for index, item in enumerate(disk["items"]):
            held = {key: item[key] for key in ("sig", "doc") if item.get(key)}
            if held:
                rows.append([index, held])
                item = {key: value for key, value in item.items() if key not in held}
            items.append(item)
        if rows:
            parts["disk"] = {"d": rows}
            core["mathlibDisk"] = {**disk, "items": items}
    if isinstance(atlas.get("readmeWords"), dict) and atlas["readmeWords"]:
        parts["words"] = {"k": core.pop("readmeWords")}
    core["lazy"] = {"version": 1, "folder": FOLDER, "text": roadmap_part, "parts": {}}
    return core, parts


def join(core: dict, parts: dict) -> dict:
    """The atlas `split` took apart. Field order inside a record is not kept: a returned field comes last."""
    atlas = json.loads(json.dumps(core))
    atlas.pop("lazy", None)
    stages = {stage["id"]: stage for stage in atlas.get("stages", [])}
    for part in parts.values():
        for rows in part.get("t", {}).values():
            for stage_id, value in rows:
                stages[stage_id]["description"] = value
        for key, short in (("edges", "e"), ("stageEdges", "se")):
            for index, evidence in part.get(short, []):
                atlas[key][index]["evidence"] = evidence
        for index, held in part.get("d", []):
            atlas["mathlibDisk"]["items"][index].update(held)
        if "k" in part:
            atlas["readmeWords"] = part["k"]
        if "b" in part:
            atlas.setdefault("roadmapBibliographies", {}).update(part["b"])
    return atlas


def encode(part: dict) -> str:
    return json.dumps(part, ensure_ascii=False, separators=(",", ":"))


def part_script(name: str, part: dict) -> str:
    """The part as a script: one call handing the page the part's JSON as a string, which a browser reads faster
    than the same data written as a literal."""
    text = json.dumps(encode(part), ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f"{CALLBACK}({json.dumps(name)},{text});\n"


def inline_part(name: str, part: dict) -> str:
    """The part as the page's offline copy carries it (src/lazy.js writes the same when it makes one)."""
    text = encode(part).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f'<script type="application/json" {INLINE_ATTRIBUTE}="{name}">{text}</script>'


def write_parts(folder: Path, parts: dict) -> dict:
    """Write the parts into `folder`, emptied first, and return the manifest: each part's file and size."""
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    manifest = {}
    for name in sorted(parts):
        data = part_script(name, parts[name]).encode("utf-8")
        file = f"{name}.{hashlib.sha256(data).hexdigest()[:12]}.js"
        (folder / file).write_bytes(data)
        manifest[name] = [file, len(data)]
    return manifest
