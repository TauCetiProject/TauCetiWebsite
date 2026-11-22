import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from tauceti_progress import apply, counts  # noqa: E402


def atlas():
    return {
        "roadmaps": [{"id": "tauceti:TauCetiRoadmap/Curves", "origin": "tauceti"}, {"id": "tauceti:TauCetiRoadmap/Covers", "origin": "tauceti"},
                     {"id": "tauceti:TauCetiRoadmap/Gone", "origin": "tauceti"}, {"id": "Proposed", "origin": "campaign"}],
        "stages": [
            {"id": "c0", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "Layer 0"},
            {"id": "c1", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "Layer 1"},
            {"id": "c1a", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "Layer 1a", "parentStageId": "c1"},
            {"id": "c1b", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "Layer 1b", "parentStageId": "c1"},
            {"id": "c1x", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "refinement", "parentStageId": "c1", "expansion": {"kind": "lemma"}},
            {"id": "c2", "owner": "tauceti:TauCetiRoadmap/Curves", "key": "Layer 2"},
            {"id": "v0", "owner": "tauceti:TauCetiRoadmap/Covers", "key": "Layer 0"},
            {"id": "g0", "owner": "tauceti:TauCetiRoadmap/Gone", "key": "Layer 0"},
        ],
        "progress": {"stages": {"c2": {"status": "complete", "basis": "old snapshot"}, "g0": {"status": "planned"}}, "roadmaps": {}},
    }


PROGRESS = {
    "exported_at": "2026-09-28T12:00:00Z",
    "rows": [
        {"id": "TauCetiRoadmap/Curves", "title": "curves", "completed": False, "layer_ids": json.dumps(["Layer 0", "Layer 1", "Layer 2"]),
         "states": json.dumps(["done", "partial", "unassessed"]), "assessment": json.dumps({"source": "marker", "remaining": {"Layer 1": "the dual isogeny"}}),
         "activity": json.dumps({"total": 12, "recent": 5, "last": "2026-09-27T10:00:00Z", "open": 1}), "readme": "TauCetiRoadmap/Curves/README.md",
         "status": {"frontier": [{"name": "The dual isogeny.", "text": "The general construction."}, {"name": "Weil pairing.", "text": "Bilinearity."}]}},
        {"id": "Completed/Covers", "title": "covers", "completed": True, "layer_ids": json.dumps(["Layer 0"]), "states": json.dumps(["partial"]),
         "assessment": json.dumps({"source": "hand-read"}), "activity": json.dumps({"total": 3, "recent": 0})},
        {"id": "TauCetiRoadmap/Fresh", "title": "fresh roadmap", "completed": False, "layer_ids": json.dumps(["Layer 0", "Layer 1"]),
         "states": json.dumps(["untouched", "partial"]), "assessment": None, "activity": None},
    ],
}


class Overlay(unittest.TestCase):
    def setUp(self):
        self.atlas = atlas()
        apply(self.atlas, PROGRESS)
        self.stages = self.atlas["progress"]["stages"]

    def test_layer_states_become_statuses_of_the_layers_leaves(self):
        self.assertEqual(self.stages["c0"]["status"], "complete")
        # A layer with sub-layers passes its state to each of them, never to a refinement.
        self.assertEqual((self.stages["c1a"]["status"], self.stages["c1b"]["status"]), ("in_progress", "in_progress"))
        self.assertNotIn("c1x", self.stages)
        self.assertIn("Tau Ceti Progress page", self.stages["c0"]["basis"])

    def test_an_unassessed_layer_has_no_status_even_if_the_snapshot_had_one(self):
        self.assertNotIn("c2", self.stages)

    def test_a_roadmap_moved_to_completed_matches_its_completed_row(self):
        # The maintainers' archiving is final, whatever the report says of a layer.
        self.assertEqual(self.stages["v0"]["status"], "complete")
        self.assertEqual(self.atlas["progress"]["roadmaps"]["tauceti:TauCetiRoadmap/Covers"]["status"], "complete")

    def test_a_roadmap_the_page_no_longer_reports_keeps_its_snapshot(self):
        self.assertEqual(self.stages["g0"]["status"], "planned")

    def test_notes_activity_and_roadmaps_not_on_the_map_are_kept_for_the_page(self):
        info = self.atlas["taucetiProgress"]
        self.assertEqual(info["exportedAt"], "2026-09-28T12:00:00Z")
        self.assertEqual(info["remaining"]["c1"], "the dual isogeny")
        self.assertEqual(info["roadmaps"]["tauceti:TauCetiRoadmap/Curves"]["activity"]["recent"], 5)
        self.assertEqual(info["roadmaps"]["tauceti:TauCetiRoadmap/Curves"]["status"], "https://github.com/TauCetiProject/TauCetiRoadmap/blob/main/TauCetiRoadmap/Curves/STATUS.md")
        self.assertEqual(info["roadmaps"]["tauceti:TauCetiRoadmap/Curves"]["frontier"], ["The dual isogeny.", "Weil pairing."])
        self.assertEqual([row["id"] for row in info["unplaced"]], ["TauCetiRoadmap/Fresh"])

    def test_counts_are_the_boards_own_layer_counts(self):
        self.assertEqual(counts(PROGRESS), {"done": 1, "partial": 3, "untouched": 1, "unassessed": 1, "total": 6})



class TauCetiOnly(unittest.TestCase):
    def test_the_tau_ceti_build_keeps_only_the_roadmaps_the_board_reports(self):
        from tauceti_progress import tauceti_only
        data = atlas()
        data["stages"].append({"id": "p0", "owner": "Proposed", "key": "P0"})
        data.update({
            "stageEdges": [{"source": "c0", "target": "c1"}, {"source": "p0", "target": "c0"}],
            "edges": [{"source": "tauceti:TauCetiRoadmap/Curves", "target": "tauceti:TauCetiRoadmap/Covers"}, {"source": "Proposed", "target": "tauceti:TauCetiRoadmap/Curves"}],
            "roadmapLinks": [], "decompositions": [], "papers": [{"id": "paper:X"}], "restructurings": [{"id": "RS-1"}], "blueprintLayers": ["Proposed:P0"],
            "opportunities": {"areas": [{"id": "gap"}], "groups": [{"id": "g"}], "notes": []}, "deferredLinks": [], "unresolvedRepositoryLinks": [],
            "stagePresentation": {"c0": {"summary": "x"}, "p0": {"summary": "y"}}, "mappedStageStatuses": {}, "libraryStatuses": {"p0": {"status": "complete"}},
            "landmarkHidden": {"p0::landmark:1": "why"}, "landmarkLabels": {"c0::landmark:1": "Name"}, "roadmapSummaries": {"Proposed": "s", "tauceti:TauCetiRoadmap/Curves": "t"},
            "roadmapClassification": {"roadmaps": {"Proposed": {}, "tauceti:TauCetiRoadmap/Curves": {}}}, "roadmapDistances": {"roadmaps": {"Proposed": {}}},
            "libraryCoverage": {"reviews": {}, "pendingReview": [], "layers": {"p0": {}}},
        })
        apply(data, PROGRESS)
        cut = tauceti_only(data)
        self.assertEqual(cut["variant"], "tauceti")
        self.assertEqual([r["id"] for r in cut["roadmaps"]], ["tauceti:TauCetiRoadmap/Curves", "tauceti:TauCetiRoadmap/Covers"])
        self.assertEqual({s["owner"] for s in cut["stages"]}, {"tauceti:TauCetiRoadmap/Curves", "tauceti:TauCetiRoadmap/Covers"})
        self.assertEqual(cut["stageEdges"], [{"source": "c0", "target": "c1"}])
        self.assertEqual(len(cut["edges"]), 1)
        self.assertEqual((cut["papers"], cut["restructurings"], cut["blueprintLayers"], cut["opportunities"]["areas"]), ([], [], [], []))
        self.assertEqual(list(cut["stagePresentation"]), ["c0"])
        self.assertEqual((cut["libraryStatuses"], cut["landmarkHidden"], cut["libraryCoverage"]["layers"]), ({}, {}, {}))
        self.assertEqual(list(cut["roadmapSummaries"]), ["tauceti:TauCetiRoadmap/Curves"])
        self.assertEqual(list(cut["roadmapClassification"]["roadmaps"]), ["tauceti:TauCetiRoadmap/Curves"])
        self.assertNotIn("g0", cut["progress"]["stages"])



class NewRoadmaps(unittest.TestCase):
    """A roadmap Tau Ceti accepts appears on the Tau Ceti atlas at the next refresh."""
    README = """# Roadmap: restricted products and adelic diagonals

The generic infrastructure for restricted products, used by [global number fields](../GlobalFields/README.md).

## Layer 0: reference families and the integral subgroup

Families of open subgroups.

## Layer 1: functoriality and reindexing

Change of family.
"""

    def board(self, *rows):
        return {"exported_at": "2026-09-28T12:00:00Z", "rows": list(rows)}

    def row(self, name, layers, states, readme=True):
        return {"id": "TauCetiRoadmap/" + name, "title": name.lower(), "completed": False, "readme": f"TauCetiRoadmap/{name}/README.md" if readme else None,
                "layer_ids": json.dumps([layer.split(":")[0] for layer in layers]), "layers": json.dumps(layers), "states": json.dumps(states)}

    def atlas(self):
        return {"roadmaps": [{"id": "tauceti:TauCetiRoadmap/GlobalFields", "origin": "tauceti", "group": "classical", "stages": []},
                             {"id": "tauceti:TauCetiRoadmap/Schemes", "origin": "tauceti", "group": "schemes", "stages": []}],
                "stages": [], "roadmapLinks": [], "progress": {"stages": {}, "roadmaps": {}},
                "groups": [{"id": "classical", "label": "Number fields and class field theory"}, {"id": "schemes", "label": "Schemes, curves and moduli"},
                           {"id": "etale", "label": "Etale cohomology"}],
                "fields": [{"id": "algebraic-geometry", "label": "Algebraic geometry", "groupIds": ["schemes", "etale"]}]}

    def test_a_new_roadmap_is_built_from_its_readme_and_placed_by_its_links(self):
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        board = self.board(self.row("RestrictedProducts", ["Layer 0: reference families and the integral subgroup", "Layer 1: functoriality and reindexing"], ["partial", "untouched"]))
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/RestrictedProducts": self.README})
        self.assertEqual(added, ["tauceti:TauCetiRoadmap/RestrictedProducts"])
        roadmap = data["roadmaps"][-1]
        self.assertEqual((roadmap["title"], roadmap["group"], roadmap["origin"]), ("Restricted products and adelic diagonals", "classical", "tauceti"))
        stages = [s for s in data["stages"] if s["owner"] == roadmap["id"]]
        self.assertEqual([(s["key"], s["title"]) for s in stages], [("Layer 0", "reference families and the integral subgroup"), ("Layer 1", "functoriality and reindexing")])
        self.assertEqual(stages[1]["requires"], [stages[0]["id"]])
        self.assertIn("Families of open subgroups.", stages[0]["description"])
        self.assertEqual(data["roadmapLinks"][-1]["target"], "tauceti:TauCetiRoadmap/GlobalFields")
        apply(data, board)
        self.assertEqual(data["progress"]["stages"][stages[0]["id"]]["status"], "in_progress")
        self.assertEqual(data["taucetiProgress"]["unplaced"], [])

    def test_a_new_roadmap_is_summarised_by_its_opening_prose(self):
        from tauceti_progress import summary
        text = ("# Roadmap: x\n\n| a | b |\n|---|---|\n\nShort opening, see [the ring roadmap](../Rings/README.md).\n\n## Scope\n\n- a list item\n\n```lean\nexample : 1 = 1 := rfl\n```\n\n"
                "**Bold opening.** It still counts as prose.\n\n"
                + " ".join(["Every layer is planned against Mathlib and the sources."] * 8) + "\n")
        words = summary(text).split()
        self.assertTrue(40 <= len(words) <= 160)
        self.assertTrue(summary(text).startswith("Short opening, see the ring roadmap."))
        self.assertNotIn("|", summary(text))
        self.assertIn("Bold opening", summary(text))
        self.assertNotIn("rfl", summary(text))
        # The panel shows a summary as plain text, so emphasis and code marks go.
        self.assertTrue(summary("**Summary.** The bound `Det(C) = g` holds for __every__ tower. " + "More words. " * 30).startswith(
            "Summary. The bound Det(C) = g holds for every tower."))

    def test_a_summary_starts_where_the_readme_says_what_the_roadmap_does(self):
        from tauceti_progress import summary
        text = ("# Roadmap: y\n\nMathlib has the algebra and nothing for it to act on. It has " + "a great many things, " * 90 + "and more.\n\n"
                "This roadmap develops " + "the arithmetic of the groups, " * 12 + "and their local theory.\n")
        self.assertTrue(summary(text).startswith("This roadmap develops"))
        self.assertGreaterEqual(len(summary("# Roadmap: z\n\nShort first sentence. It has " + "a great many things, " * 90 + "and more.\n").split()), 40)

    def test_a_roadmap_with_no_links_is_placed_by_its_title_and_one_with_no_signal_waits(self):
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        board = self.board(self.row("RealAlgebraicGeometry", ["Layer 1: univariate real algebra"], ["done"]),
                           self.row("Mystery", ["Layer 0: things"], ["untouched"]))
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/RealAlgebraicGeometry": "# Real algebraic geometry: sign determination\n\n## Layer 1: univariate real algebra\n\nSturm sequences.\n",
                                                "TauCetiRoadmap/Mystery": "# Roadmap: things\n\n## Layer 0: things\n\nStuff.\n"})
        self.assertEqual(added, ["tauceti:TauCetiRoadmap/RealAlgebraicGeometry"])
        self.assertEqual(data["roadmaps"][-1]["group"], "schemes")
        apply(data, board)
        self.assertEqual([row["id"] for row in data["taucetiProgress"]["unplaced"]], ["TauCetiRoadmap/Mystery"])

    def test_the_title_comes_before_the_roadmaps_a_readme_names_and_a_tie_waits_for_a_choice(self):
        from tauceti_progress import add_new_roadmaps
        data = {"roadmaps": [{"id": "tauceti:TauCetiRoadmap/PDE", "origin": "tauceti", "group": "pde", "stages": []},
                             {"id": "tauceti:TauCetiRoadmap/AlgebraicTopology", "origin": "tauceti", "group": "topology", "stages": []}],
                "stages": [], "roadmapLinks": [], "progress": {"stages": {}, "roadmaps": {}},
                "groups": [{"id": "pde", "label": "Partial differential equations"}, {"id": "topology", "label": "Topology"},
                           {"id": "diffgeom", "label": "Differential geometry"}, {"id": "grouptheory", "label": "Group theory"}],
                "fields": [{"id": "differential-geometry", "label": "Differential geometry", "groupIds": ["diffgeom"]}]}
        # Both READMEs name one roadmap in each of two areas: the roadmaps they build on.
        names = "It builds on [PDE](../PDE/README.md) and [algebraic topology](../AlgebraicTopology/README.md).\n\n## Layer 0: forms\n\nForms.\n"
        board = self.board(self.row("DifferentialGeometry", ["Layer 0: forms"], ["untouched"]), self.row("Peripheral", ["Layer 0: forms"], ["untouched"]))
        readmes = {"TauCetiRoadmap/DifferentialGeometry": "# Roadmap: differential geometry — forms, flows, and degree\n\n" + names,
                   "TauCetiRoadmap/Peripheral": "# Roadmap: peripheral actions\n\n" + names}
        self.assertEqual(add_new_roadmaps(data, board, readmes, {}), ["tauceti:TauCetiRoadmap/DifferentialGeometry"])
        self.assertEqual(data["roadmaps"][-1]["group"], "diffgeom")
        self.assertEqual(data["roadmapClassification"]["roadmaps"]["tauceti:TauCetiRoadmap/DifferentialGeometry"]["rationale"],
                         "Placed provisionally in the area its title names.")
        # The tie is not broken by name; a maintainer's choice settles it.
        chosen = {"TauCetiRoadmap/Peripheral": {"galaxy": "grouptheory", "reason": "group theory about free pro-p groups."}}
        self.assertEqual(add_new_roadmaps(data, board, readmes, chosen), ["tauceti:TauCetiRoadmap/Peripheral"])
        self.assertEqual(data["roadmaps"][-1]["group"], "grouptheory")
        record = data["roadmapClassification"]["roadmaps"]["tauceti:TauCetiRoadmap/Peripheral"]
        self.assertEqual((record["basis"], record["rationale"]), ("provisional", "Placed where the maintainers chose: group theory about free pro-p groups."))

    def test_a_roadmap_the_page_lists_without_layers_takes_them_from_its_readme_unassessed(self):
        # The board reads `## Layer 1: …` and `## A1: …` but not `## A1. …`, so a README written that
        # way reaches it with no layers (34 of its 137 roadmaps on 2026-10-20), and such a roadmap
        # used to stay off the map.
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        readme = ("# Etale cohomology of curves\n\n## Scope and conventions\n\nWhat is consumed.\n\n"
                  "## A1. Constructible sheaves\n\nFinite locally constant sheaves.\n\n"
                  "## A2. Cohomology with supports\n\n### A2.1. Excision\n\nThe long exact sequence.\n\n## References\n\nMilne.\n")
        board = self.board(self.row("EtaleCurves", [], []))
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/EtaleCurves": readme}, {})
        self.assertEqual(added, ["tauceti:TauCetiRoadmap/EtaleCurves"])
        self.assertEqual(data["roadmaps"][-1]["group"], "etale")
        stages = [s for s in data["stages"] if s["owner"] == added[0]]
        self.assertEqual([(s["key"], s["title"]) for s in stages], [("A1", "Constructible sheaves"), ("A2", "Cohomology with supports")])
        self.assertEqual(stages[1]["requires"], [stages[0]["id"]])
        self.assertIn("The long exact sequence.", stages[1]["description"])
        apply(data, board)
        info = data["taucetiProgress"]
        self.assertEqual(info["unplaced"], [])
        self.assertFalse({s["id"] for s in stages} & set(data["progress"]["stages"]))
        self.assertEqual(info["roadmaps"][added[0]]["layers"], "readme")
        self.assertEqual(info["readmeLayers"], added)
        # They count, unassessed, so the share done dips when such a roadmap is accepted.
        self.assertEqual(info["counts"], {"done": 0, "partial": 0, "untouched": 0, "unassessed": 2, "total": 2})

    def test_a_family_index_without_layers_joins_as_a_collection_of_its_roadmaps(self):
        # Representation theory is in the snapshot with no layers and its sub-roadmaps under it. A family Tau Ceti accepts
        # since is read the same way: its README has no layers, and the roadmaps below it name it as their parent.
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        child = dict(self.row("Etale/Curves", ["Layer 0: sheaves"], ["untouched"]), parent_id="TauCetiRoadmap/Etale")
        board = self.board(self.row("Etale", [], []), child, self.row("Overview", [], []))
        index = "# Etale cohomology\n\nA family of roadmaps.\n\n## The roadmaps\n\n## How they depend on one another\n"
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/Etale": index, "TauCetiRoadmap/Etale/Curves": "# Etale cohomology of curves\n\n## Layer 0: sheaves\n\nSheaves.\n",
                                               "TauCetiRoadmap/Overview": index}, {})
        self.assertEqual(added, ["tauceti:TauCetiRoadmap/Etale/Curves", "tauceti:TauCetiRoadmap/Etale"])
        family = data["roadmaps"][-1]
        self.assertEqual((family["stages"], family["group"], family["origin"]), ([], "etale", "tauceti"))
        self.assertNotIn("layersFrom", family)
        self.assertEqual(data["roadmaps"][-2]["parentRoadmapId"], family["id"])
        apply(data, board)
        info = data["taucetiProgress"]
        # A README without layers and nothing below it stays off the map, as before; a collection counts no layers.
        self.assertEqual([row["id"] for row in info["unplaced"]], ["TauCetiRoadmap/Overview"])
        self.assertEqual((info["readmeLayers"], info["counts"]["total"]), ([], 1))

    def test_the_boards_own_layers_come_before_the_readmes(self):
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        board = self.board(self.row("EtaleCurves", ["Layer 0: sheaves"], ["done"]))
        readme = "# Etale cohomology of curves\n\n## Layer 0: sheaves\n\nSheaves.\n\n### A1. Constructible sheaves\n\nMore.\n"
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/EtaleCurves": readme}, {})
        self.assertEqual([s["key"] for s in data["stages"] if s["owner"] == added[0]], ["Layer 0"])
        apply(data, board)
        self.assertNotIn("layers", data["taucetiProgress"]["roadmaps"][added[0]])
        self.assertEqual((data["taucetiProgress"]["readmeLayers"], data["taucetiProgress"]["counts"]["total"]), ([], 1))


class ReadmeLayers(unittest.TestCase):
    """The layers of a README whose headings Tau Ceti's Progress page cannot read."""

    def test_the_labels_tau_ceti_roadmaps_use(self):
        from tauceti_progress import readme_layers
        cases = [
            ("a full stop after the label", "## Scope and conventions\n\n## A1. Currents and cohomology\n\n## A2. Levels (draft)\n",
             [("A1", "A1. Currents and cohomology"), ("A2", "A2. Levels")]),
            ("a longer prefix and a dash", "### CG1 — Contact distributions\n\n### CG2 — Reeb dynamics\n",
             [("CG1", "CG1 — Contact distributions"), ("CG2", "CG2 — Reeb dynamics")]),
            ("numbers, with sub-numbers beneath", "## Milestones at a glance\n\n## 1. Shared foundations\n\n### 1.1. Walks\n\n## 2. Cuts and separators\n",
             [("1", "1. Shared foundations"), ("2", "2. Cuts and separators")]),
            ("dotted labels with no separator", "## G.1 Compactification objects\n\n## F.0.A1 Decomposition groups\n\n## 0.5 Finite presentation\n",
             [("G.1", "G.1 Compactification objects"), ("F.0.A1", "F.0.A1 Decomposition groups"), ("0.5", "0.5 Finite presentation")]),
            ("a sub-label at the same level stays, in order", "## I1. Involutive functions\n\n## I2.0. Circles\n\n## I2. Liouville–Arnold\n\n### I2.1. Action-angle\n",
             [("I1", "I1. Involutive functions"), ("I2.0", "I2.0. Circles"), ("I2", "I2. Liouville–Arnold")]),
            ("a bare letter among the labels", "## Scope\n\n### K1. Resolution circles\n\n### G. Plane geometry\n\n### K2. Frobenius object\n",
             [("K1", "K1. Resolution circles"), ("G", "G. Plane geometry"), ("K2", "K2. Frobenius object")]),
            ("worded headings, as the board reads them", "## Layer 1: Poisson summation\n\n### A1. detail\n\n## Layer 2: theta series\n",
             [("Layer 1", "Layer 1: Poisson summation"), ("Layer 2", "Layer 2: theta series")]),
            ("a later mention of a layer", "## A1. Constructions\n\n## A2. Calculus\n\n## A1. Constructions, revisited\n",
             [("A1", "A1. Constructions"), ("A2", "A2. Calculus")]),
            ("the sub-headings of a section about the layers", "## Introduction\n\n## The build, in layers\n\n### Gram rigidity\n\n### Orthogonal series\n\n## References\n",
             [("Gram rigidity", "Gram rigidity"), ("Orthogonal series", "Orthogonal series")]),
            ("an umbrella over other roadmaps", "## Scope\n\n## The roadmaps\n\n## How they depend on one another\n", []),
            ("titles that start with a name such as L2 or K3", "## L2 cohomology\n\n## K3 surfaces and H1 classes\n", []),
        ]
        for case, text, layers in cases:
            with self.subTest(case):
                self.assertEqual(readme_layers("# Roadmap\n\nIntro.\n\n" + text), layers)


class ArxivAreas(unittest.TestCase):
    """A Tau Ceti roadmap sits in an area its own arXiv category allows (data/tauceti-arxiv-areas.json)."""
    CATEGORIES = {"math.GR": {"areas": ["grouptheory"], "default": "grouptheory"},
                  "math.NT": {"areas": ["classical", "iwasawa"], "default": "classical"},
                  "math.RT": {"areas": ["representations"], "default": "representations"}}
    TOPICS = {"math.GR": "Group Theory", "math.NT": "Number Theory", "math.RT": "Representation Theory"}

    def atlas(self):
        return {"roadmaps": [{"id": "tauceti:TauCetiRoadmap/GlobalFields", "origin": "tauceti", "group": "classical", "stages": [],
                              "title": "Global fields", "readme": "# Global fields\n"},
                             {"id": "tauceti:TauCetiRoadmap/GrothendieckForms", "origin": "tauceti", "group": "homological", "stages": [],
                              "title": "Grothendieck groups, Cartan maps and Euler forms", "readme": "# Grothendieck groups\n"}],
                "stages": [], "roadmapLinks": [], "progress": {"stages": {}, "roadmaps": {}},
                "groups": [{"id": "classical", "label": "Number fields and class field theory"}, {"id": "iwasawa", "label": "Iwasawa theory and special values"},
                           {"id": "grouptheory", "label": "Group theory"}, {"id": "representations", "label": "Representation theory"},
                           {"id": "homological", "label": "Homological algebra"}],
                "fields": []}

    def row(self, name, arxiv):
        return {"id": "TauCetiRoadmap/" + name, "title": name, "completed": False, "readme": f"TauCetiRoadmap/{name}/README.md",
                "arxiv": arxiv, "topic": self.TOPICS[arxiv], "layer_ids": json.dumps(["Layer 0"]), "layers": json.dumps(["Layer 0: things"]),
                "states": json.dumps(["untouched"])}

    def test_a_new_roadmap_goes_where_its_category_allows_even_against_its_readme(self):
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        board = {"exported_at": "2026-10-14T00:00:00Z", "rows": [self.row("RestrictedProducts", "math.GR")]}
        # The README names a number-field roadmap, which used to put it among the number fields.
        readme = "# Roadmap: restricted products of topological groups\n\nUsed by [global fields](../GlobalFields/README.md).\n\n## Layer 0: things\n\nStuff.\n"
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/RestrictedProducts": readme}, {}, self.CATEGORIES)
        self.assertEqual(added, ["tauceti:TauCetiRoadmap/RestrictedProducts"])
        self.assertEqual(data["roadmaps"][-1]["group"], "grouptheory")
        self.assertEqual(data["roadmapClassification"]["roadmaps"][added[0]]["rationale"], "Placed by its arXiv category, math.GR (Group Theory).")

    def test_the_title_still_chooses_among_the_areas_the_category_allows(self):
        from tauceti_progress import add_new_roadmaps
        data = self.atlas()
        board = {"exported_at": "2026-10-14T00:00:00Z", "rows": [self.row("PadicMeasures", "math.NT")]}
        readme = "# Roadmap: p-adic measures for Iwasawa theory and special values\n\n## Layer 0: things\n\nStuff.\n"
        added = add_new_roadmaps(data, board, {"TauCetiRoadmap/PadicMeasures": readme}, {}, self.CATEGORIES)
        self.assertEqual(data["roadmaps"][-1]["group"], "iwasawa")
        self.assertIn("among the areas its arXiv category (math.NT) allows", data["roadmapClassification"]["roadmaps"][added[0]]["rationale"])

    def test_a_snapshot_roadmap_outside_its_category_moves_and_one_inside_stays(self):
        from tauceti_progress import fit_to_arxiv
        data = self.atlas()
        board = {"rows": [self.row("GrothendieckForms", "math.RT"), self.row("GlobalFields", "math.NT")]}
        self.assertEqual(fit_to_arxiv(data, board, self.CATEGORIES), ["tauceti:TauCetiRoadmap/GrothendieckForms"])
        self.assertEqual({r["id"].split("/")[-1]: r["group"] for r in data["roadmaps"]},
                         {"GlobalFields": "classical", "GrothendieckForms": "representations"})
        record = data["roadmapClassification"]["roadmaps"]["tauceti:TauCetiRoadmap/GrothendieckForms"]
        self.assertEqual(record["basis"], "arxiv")
        self.assertIn("math.RT (Representation Theory)", record["rationale"])


if __name__ == "__main__":
    unittest.main()
