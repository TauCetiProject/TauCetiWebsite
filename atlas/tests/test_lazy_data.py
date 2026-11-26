"""The page's data in a core and parts (scripts/lazy_data.py), the links that stand in for the READMEs
(scripts/build.py, link_roadmaps) and what the build keeps of the READMEs for the page (scripts/derive.js)."""
import collections
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build  # noqa: E402
from lazy_data import CALLBACK, FOLDER, inline_part, join, part_script, split, text_part, write_parts  # noqa: E402

NODE = os.environ.get("ATLAS_NODE") or shutil.which("node") or shutil.which("nodejs")

README = """# Roadmap: sample

## References

- Serre, *A Course in Arithmetic*, Chapter VII.

## Layer 1: lattices

**Definition.** A lattice is a discrete subgroup of full rank in a real vector space of finite dimension.

**Construct.** Prove Theorem 2.1 on the covolume of a sublattice of finite index, following Serre, Chapter VII §1.

## Layer 2: theta series

Define the theta series of an even unimodular lattice and show that it is a modular form of weight half the rank.
"""


def atlas() -> dict:
    """A small atlas with every kind of field the split moves, and one family that must stay whole."""
    layer1 = README[README.index("## Layer 1"):README.index("## Layer 2")]
    layer2 = README[README.index("## Layer 2"):]
    return {
        "roadmaps": [{"id": "tauceti:T/A", "title": "Sample", "summary": "s", "readme": README, "sourcePath": "content/A/README.md", "origin": "tauceti"},
                     {"id": "tauceti:T/B", "title": "Other", "summary": "s", "readme": "", "sourcePath": "https://github.com/o/r/blob/abc/B/README.md", "origin": "proposed"}],
        "stages": [{"id": "tauceti:T/A#l1", "owner": "tauceti:T/A", "key": "L1", "title": "Layer 1: lattices", "description": layer1, "sourceLine": 7, "sourcePath": "content/A/README.md"},
                   {"id": "tauceti:T/A#l2", "owner": "tauceti:T/A", "key": "L2", "title": "Layer 2: theta series", "description": layer2, "sourceLine": 13, "sourcePath": "content/A/README.md"},
                   {"id": "tauceti:T/B#l1", "owner": "tauceti:T/B", "key": "L1", "title": "One", "description": "## One\n\nA first layer of the other roadmap, with a < sign and a \u2028 separator.\n"},
                   # A layer whose sub-layer belongs to another roadmap: the page reads the two together.
                   {"id": "tauceti:T/B#l2", "owner": "tauceti:T/B", "key": "L2", "title": "Two", "description": "## Two\n\nA second layer.\n"},
                   {"id": "tauceti:T/A#l3", "owner": "tauceti:T/A", "key": "L3", "title": "Three", "description": "### Three\n\nA sub-layer.\n", "parentStageId": "tauceti:T/B#l2"},
                   {"id": "tauceti:T/A#l4", "owner": "tauceti:T/A", "key": "L4", "title": "Four", "description": ""}],
        "edges": [{"source": "tauceti:T/A", "target": "tauceti:T/B", "kind": "readme", "evidence": [{"readme": "https://github.com/o/r/blob/main/B/README.md", "line": 3}]},
                  {"source": "tauceti:T/B", "target": "tauceti:T/A", "kind": "declared"}],
        "stageEdges": [{"source": "tauceti:T/A#l1", "target": "tauceti:T/A#l2", "evidence": {"basis": "README order"}}],
        "mathlibDisk": {"commit": "c", "items": [{"id": "mathlib:Set", "t": "Set", "sig": "Set (α : Type u) : Type u", "doc": "A set."}, {"id": "mathlib:X", "t": "X"}]},
        "readmeWords": {"tauceti:T/A": {"1": "lattice", "2": "theta"}},
        "roadmapBibliographies": {"tauceti:T/A": [["- Serre, *A Course in Arithmetic*, Chapter VII.", 5]]},
        "meta": {},
    }


class Split(unittest.TestCase):
    def test_the_core_keeps_what_the_map_draws_and_loses_the_long_text(self):
        whole = atlas()
        core, parts = split(whole)
        stages = {stage["id"]: stage for stage in core["stages"]}
        for stage_id in ("tauceti:T/A#l1", "tauceti:T/A#l2", "tauceti:T/B#l1"):
            self.assertNotIn("description", stages[stage_id])
            self.assertEqual(stages[stage_id]["title"], next(s for s in whole["stages"] if s["id"] == stage_id)["title"])
        self.assertNotIn("evidence", core["edges"][0])
        self.assertNotIn("evidence", core["stageEdges"][0])
        self.assertEqual(core["mathlibDisk"]["items"][0], {"id": "mathlib:Set", "t": "Set"})
        self.assertNotIn("readmeWords", core)
        self.assertNotIn("roadmapBibliographies", core)
        self.assertEqual(parts[text_part("tauceti:T/A")]["b"], whole["roadmapBibliographies"])
        self.assertEqual(sorted(parts), sorted({"disk", "links", "words", text_part("tauceti:T/A"), text_part("tauceti:T/B")}))
        # The atlas given is not changed.
        self.assertEqual(whole, atlas())

    def test_a_family_of_layers_from_two_roadmaps_stays_in_the_core(self):
        core, parts = split(atlas())
        stages = {stage["id"]: stage for stage in core["stages"]}
        self.assertIn("description", stages["tauceti:T/B#l2"])
        self.assertIn("description", stages["tauceti:T/A#l3"])
        moved = {stage_id for part in parts.values() for rows in part.get("t", {}).values() for stage_id, _text in rows}
        self.assertEqual(moved, {"tauceti:T/A#l1", "tauceti:T/A#l2", "tauceti:T/B#l1"})

    def test_the_manifest_names_each_roadmaps_part(self):
        core, parts = split(atlas())
        self.assertEqual(core["lazy"]["text"], {"tauceti:T/A": text_part("tauceti:T/A"), "tauceti:T/B": text_part("tauceti:T/B")})
        self.assertEqual(core["lazy"]["folder"], FOLDER)
        self.assertRegex(text_part("tauceti:T/A"), r"^text-\d\d$")

    def test_joining_gives_the_atlas_back(self):
        whole = atlas()
        core, parts = split(whole)
        self.assertEqual(join(core, parts), whole)
        # A part read back from its script, as the page reads it.
        read = {}
        for name, part in parts.items():
            script = part_script(name, part)
            head = f'{CALLBACK}({json.dumps(name)},'
            self.assertTrue(script.startswith(head) and script.endswith(");\n"))
            self.assertNotIn("\u2028", script)
            read[name] = json.loads(json.loads(script[len(head):-3]))
        self.assertEqual(join(core, read), whole)

    def test_an_offline_copy_carries_a_part_as_inert_json(self):
        core, parts = split(atlas())
        name = text_part("tauceti:T/B")
        element = inline_part(name, parts[name])
        match = re.fullmatch(r'<script type="application/json" data-atlas-part="([^"]+)">(.*)</script>', element, re.S)
        self.assertEqual(match[1], name)
        self.assertNotIn("<", match[2])
        self.assertEqual(json.loads(match[2]), parts[name])


class Written(unittest.TestCase):
    def test_parts_are_written_under_their_contents_hash_and_stale_ones_go(self):
        core, parts = split(atlas())
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / FOLDER
            folder.mkdir()
            (folder / "text-00.000000000000.js").write_text("stale")
            manifest = write_parts(folder, parts)
            self.assertEqual(sorted(path.name for path in folder.iterdir()), sorted(file for file, _size in manifest.values()))
            for name, (file, size) in manifest.items():
                self.assertRegex(file, r"^" + re.escape(name) + r"\.[0-9a-f]{12}\.js$")
                self.assertEqual((folder / file).stat().st_size, size)
            again = write_parts(folder, parts)
            self.assertEqual(again, manifest)
            parts["links"]["e"][0][1][0]["line"] = 4
            changed = write_parts(folder, parts)
            self.assertNotEqual(changed["links"][0], manifest["links"][0])
            self.assertEqual({name: entry for name, entry in changed.items() if name != "links"}, {name: entry for name, entry in manifest.items() if name != "links"})


class Links(unittest.TestCase):
    def roadmaps(self):
        return {"roadmaps": [{"id": "tauceti:TauCetiRoadmap/Modular Forms"}, {"id": "tauceti:TauCetiRoadmap/Old"}, {"id": "tauceti:TauCetiRoadmap/Fork"},
                             {"id": "tauceti:TauCetiRoadmap/PullOnly", "pull": {"url": "https://github.com/TauCetiProject/TauCetiRoadmap/pull/12"}},
                             {"id": "tauceti:TauCetiRoadmap/Nothing", "pull": {"url": "javascript:alert(1)"}}]}

    def test_a_roadmap_with_a_row_links_to_its_page_and_any_other_to_what_the_build_read(self):
        data = self.roadmaps()
        rows = {"tauceti:TauCetiRoadmap/Modular Forms": {"id": "TauCetiRoadmap/Modular Forms"}, "tauceti:TauCetiRoadmap/Old": {"id": "Completed/Old"}}
        sources = {"tauceti:TauCetiRoadmap/Modular Forms": "https://github.com/TauCetiProject/TauCetiRoadmap/blob/main/TauCetiRoadmap/ModularForms/README.md",
                   "tauceti:TauCetiRoadmap/Fork": "https://github.com/someone/TauCetiRoadmap/blob/0123abc/TauCetiRoadmap/Fork/README.md",
                   "tauceti:TauCetiRoadmap/Nothing": "content/local/README.md"}
        counts = build.link_roadmaps(data, rows, sources, frozenset({"tauceti:TauCetiRoadmap/Modular Forms"}))
        by_id = {roadmap["id"]: roadmap for roadmap in data["roadmaps"]}
        page = by_id["tauceti:TauCetiRoadmap/Modular Forms"]["page"]
        self.assertEqual(page["on"], "site")
        # The website reads the id back with URLSearchParams (static/js/roadmap.js).
        self.assertEqual(parse_qs(urlparse(page["href"]).query)["id"], ["TauCetiRoadmap/Modular Forms"])
        self.assertTrue(page["href"].startswith("https://taucetiproject.org/roadmap.html?id=TauCetiRoadmap%2FModular%20Forms"))
        self.assertEqual(by_id["tauceti:TauCetiRoadmap/Old"]["page"]["href"], "https://taucetiproject.org/roadmap.html?id=Completed%2FOld")
        # A copy older than main's README: cited at the file, not at a line of it.
        self.assertIs(by_id["tauceti:TauCetiRoadmap/Modular Forms"]["readmeLines"], False)
        self.assertNotIn("readmeLines", by_id["tauceti:TauCetiRoadmap/Fork"])
        self.assertNotIn("readmeSource", by_id["tauceti:TauCetiRoadmap/Old"])
        self.assertEqual(by_id["tauceti:TauCetiRoadmap/Fork"]["page"], {"href": sources["tauceti:TauCetiRoadmap/Fork"], "on": "github"})
        self.assertEqual(by_id["tauceti:TauCetiRoadmap/Fork"]["readmeSource"], sources["tauceti:TauCetiRoadmap/Fork"])
        self.assertEqual(by_id["tauceti:TauCetiRoadmap/PullOnly"]["page"]["on"], "pull")
        # Nothing the build has seen: no link, rather than a guess.
        self.assertNotIn("page", by_id["tauceti:TauCetiRoadmap/Nothing"])
        self.assertNotIn("readmeSource", by_id["tauceti:TauCetiRoadmap/Nothing"])
        self.assertEqual(counts, {"site": 2, "github": 1, "pull": 1, "none": 1})


@unittest.skipUnless(NODE, "needs Node")
class Derived(unittest.TestCase):
    """scripts/derive.js checks itself: it fails unless the page, given its output and no README, shows every planet and
    citation that the page's code makes of the whole text."""

    @classmethod
    def setUpClass(cls):
        cls.atlas = atlas()
        cls.atlas["stages"] = [stage for stage in cls.atlas["stages"] if stage["id"] not in ("tauceti:T/A#l3",)]
        cls.text, cls.bibliographies, cls.words = build.derive(cls.atlas)
        cls.derived = json.loads(cls.text)

    def test_the_planets_are_kept_with_where_their_passages_lie(self):
        stages = self.atlas["stages"]
        rows = self.derived["landmarks"]
        self.assertTrue(rows)
        for at, title, kind, start, end, line, shown, excerpt, *cited in rows:
            passage = stages[at]["description"].encode("utf-16-le")[2 * start:2 * end].decode("utf-16-le")
            self.assertTrue(passage.strip() == passage and passage)
            self.assertIn(kind, ("definition", "theorem", "construction"))
            if stages[at]["owner"] == "tauceti:T/A":
                self.assertEqual(README.split("\n")[line - 1], passage.split("\n")[0])
            self.assertLessEqual(len(excerpt), 220)

    def test_citations_keep_their_readme_lines(self):
        references = self.derived["references"]
        self.assertEqual(self.bibliographies, {"tauceti:T/A": [["- Serre, *A Course in Arithmetic*, Chapter VII.", 5]]})
        layer1 = next(at for at, stage in enumerate(self.atlas["stages"]) if stage["id"] == "tauceti:T/A#l1")
        self.assertEqual(references["layers"][str(layer1)], [11])

    def test_the_words_are_the_readmes_runs_of_letters_and_digits_with_their_counts(self):
        self.assertEqual(set(self.words), {"tauceti:T/A"})
        groups = self.words["tauceti:T/A"]
        counted = {word: int(count) for count, text in groups.items() for word in text.split(" ")}
        self.assertEqual(sum(len(text.split(" ")) for text in groups.values()), len(counted))
        folded = re.findall(r"[^\W_]+", README.lower())
        self.assertEqual(counted, dict(collections.Counter(folded)))
        self.assertEqual(counted["serre"], 2)
        self.assertEqual(counted["lattice"], 2)

    def test_a_text_the_page_cannot_reproduce_stops_the_build(self):
        broken = atlas()
        del broken["stages"][0]["owner"]
        with self.assertRaises(Exception):
            build.derive({"roadmaps": broken["roadmaps"]})


@unittest.skipUnless((ROOT / "index.html").exists() and (ROOT / FOLDER).is_dir() and (ROOT / "BUILD.json").exists(), "needs a built page")
class BuiltPage(unittest.TestCase):
    """The page as scripts/build.py last wrote it, when it is there."""

    @classmethod
    def setUpClass(cls):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.page = page
        cls.core = json.loads(re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>', page, re.S)[1])
        cls.report = json.loads((ROOT / "BUILD.json").read_text(encoding="utf-8"))

    def parts(self):
        read = {}
        for name, (file, size) in self.core["lazy"]["parts"].items():
            data = (ROOT / FOLDER / file).read_bytes()
            self.assertEqual(len(data), size)
            script = data.decode("utf-8")
            head = f'{CALLBACK}({json.dumps(name)},'
            self.assertTrue(script.startswith(head))
            read[name] = json.loads(json.loads(script[len(head):-3]))
        return read

    def test_no_readme_is_shipped(self):
        self.assertFalse([roadmap["id"] for roadmap in self.core["roadmaps"] if "readme" in roadmap])
        parts = self.parts()
        for part in parts.values():
            self.assertFalse(set(part) - {"t", "b", "e", "se", "d", "k"})
            for rows in part.get("t", {}).values():
                self.assertTrue(all(isinstance(text, str) for _stage, text in rows))
        # No file of the folder that the page does not name.
        self.assertEqual(sorted(path.name for path in (ROOT / FOLDER).iterdir()), sorted(file for file, _size in self.core["lazy"]["parts"].values()))

    def test_every_roadmap_links_to_a_page_this_build_saw(self):
        board = ROOT / "data" / "tauceti-progress.json"
        rows = {row["id"] for row in json.loads(board.read_text(encoding="utf-8")).get("rows", [])} if board.exists() else None
        counts = {}
        for roadmap in self.core["roadmaps"]:
            page = roadmap.get("page")
            self.assertTrue(page and page.get("href"), roadmap["id"])
            counts[page["on"]] = counts.get(page["on"], 0) + 1
            address = urlparse(page["href"])
            if page["on"] == "site":
                self.assertEqual((address.scheme, address.path), ("https", "/roadmap.html"))
                if rows is not None:
                    self.assertIn(parse_qs(address.query)["id"][0], rows)
            else:
                self.assertRegex(page["href"], r"^https://github\.com/[^\s\"<>]+$")
            if roadmap.get("readmeSource"):
                self.assertRegex(roadmap["readmeSource"], r"^https://github\.com/[^\s\"<>]+/blob/[^\s\"<>]+\.md$")
                # Never the snapshot's own commit, which is not on GitHub.
                if roadmap.get("origin") == "tauceti":
                    self.assertRegex(roadmap["readmeSource"], r"^https://github\.com/TauCetiProject/TauCetiRoadmap/blob/main/")
        self.assertEqual(counts, self.report["roadmapPages"])

    def test_the_first_frame_needs_no_part(self):
        stages = self.core["stages"]
        deferred = {stage_id for part in self.parts().values() for rows in part.get("t", {}).values() for stage_id, _text in rows}
        self.assertTrue(deferred)
        self.assertFalse([stage["id"] for stage in stages if stage["id"] in deferred and "description" in stage])
        self.assertFalse([edge for edge in self.core["edges"] + self.core["stageEdges"] if "evidence" in edge])
        # Every planet the map draws is in the page, on a layer the page has.
        rows = self.core["derived"]["landmarks"]
        self.assertTrue(all(0 <= row[0] < len(stages) and isinstance(row[1], str) and row[1] for row in rows))
        self.assertEqual(self.report["dataParts"]["count"], len(self.core["lazy"]["parts"]))

    def test_the_parts_give_every_layer_its_description_back(self):
        whole = join(self.core, self.parts())
        self.assertFalse([stage["id"] for stage in whole["stages"] if "description" not in stage])
        rows = whole["derived"]["landmarks"]
        for at, _title, _kind, start, end, *_rest in rows[:: max(1, len(rows) // 500)]:
            units = whole["stages"][at]["description"].encode("utf-16-le", "surrogatepass")
            self.assertTrue(units[2 * start:2 * end])


if __name__ == "__main__":
    unittest.main()
