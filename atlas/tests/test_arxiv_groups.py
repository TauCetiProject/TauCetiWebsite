import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from arxiv_groups import AREA_GAP, FIELD_GAP, ORDER, START, UNCLASSIFIED, area_categories, categories_of, finer_areas, group_by_arxiv  # noqa: E402

AREAS = {"math.NT": {"areas": ["algebraicnt", "padic"], "default": "algebraicnt"}, "math.AG": {"areas": ["algebraicgeometry", "etale", "padic"], "default": "algebraicgeometry"},
         "math.FA": {"areas": ["analysis"], "default": "analysis"}, "math.DS": {"areas": ["analysis"], "default": "analysis"}}


def atlas(*roadmaps, edges=(), links=()):
    return {"meta": {}, "roadmaps": [{"id": rid, "group": group} for rid, group in roadmaps],
            "edges": [{"source": s, "target": t} for s, t in edges], "roadmapLinks": [{"source": s, "target": t} for s, t in links],
            "groups": [{"id": "etale"}], "fields": [{"id": "algebraic-geometry", "groupIds": ["etale"]}]}


class Categories(unittest.TestCase):
    """Each roadmap's arXiv category, and how it was settled."""

    def test_a_roadmap_has_the_category_its_metadata_declares(self):
        found = categories_of(atlas(("tauceti:TauCetiRoadmap/Weil", "etale")), {"tauceti:TauCetiRoadmap/Weil": "math.AG"})
        self.assertEqual(found, {"tauceti:TauCetiRoadmap/Weil": ("math.AG", "declared")})

    def test_one_that_declares_none_takes_the_nearest_declared_folder_above_it_on_the_map_or_not(self):
        found = categories_of(atlas(("tauceti:TauCetiRoadmap/OperatorTheory/Unbounded", "analysis")), {"tauceti:TauCetiRoadmap/OperatorTheory": "math.FA"})
        self.assertEqual(found["tauceti:TauCetiRoadmap/OperatorTheory/Unbounded"], ("math.FA", "parent"))

    def test_else_the_category_most_of_its_linked_roadmaps_have_when_they_clearly_agree(self):
        map_ = atlas(("tauceti:A", "x"), ("tauceti:B", "x"), ("tauceti:C", "x"), ("tauceti:Lead", "x"), ("tauceti:Tie", "x"),
                     edges=[("tauceti:A", "tauceti:Lead"), ("tauceti:B", "tauceti:Lead"), ("tauceti:A", "tauceti:Tie")], links=[("tauceti:Lead", "tauceti:C"), ("tauceti:Tie", "tauceti:C")])
        found = categories_of(map_, {"tauceti:A": "math.NT", "tauceti:B": "math.NT", "tauceti:C": "math.AG"})
        self.assertEqual(found["tauceti:Lead"], ("math.NT", "links"))
        # One link to each: no lead, and no area to fall back on.
        self.assertEqual(found["tauceti:Tie"], (UNCLASSIFIED, "none"))

    def test_else_the_category_of_the_subject_its_title_named_then_none(self):
        map_ = atlas(("tauceti:Flows", "analysis"), ("tauceti:Walks", "unclassified"))
        found = categories_of(map_, {}, area_categories(AREAS))
        self.assertEqual(found, {"tauceti:Flows": ("math.FA", "area"), "tauceti:Walks": (UNCLASSIFIED, "none")})

    def test_an_area_reads_back_to_the_first_category_whose_default_it_is(self):
        self.assertEqual(area_categories(AREAS), {"algebraicnt": "math.NT", "algebraicgeometry": "math.AG", "analysis": "math.FA",
                                                  "padic": "math.NT", "etale": "math.AG"})

    def test_undeclared_sub_roadmaps_settle_together_once_some_are_placed(self):
        # Two links only to its undeclared sibling, which its title places: it follows the sibling.
        map_ = atlas(("tauceti:P/Counting/One", "etale"), ("tauceti:P/Counting/Two", "unclassified"),
                     links=[("tauceti:P/Counting/Two", "tauceti:P/Counting/One")])
        found = categories_of(map_, {}, area_categories(AREAS))
        self.assertEqual(found, {"tauceti:P/Counting/One": ("math.AG", "area"), "tauceti:P/Counting/Two": ("math.AG", "links")})

    def test_a_proposed_family_is_placed_last_and_moves_none_of_its_sub_roadmaps(self):
        # Zeta (a pull request's family index, no layers) declares math.NT, Weil below it (no layers either) none; Curves and
        # Purity declare none. They keep the places they have without the family: Curves its title's area, Purity its one link
        # outside the family. Weil has the category of most of its sub-roadmaps.
        map_ = atlas(("tauceti:T/Zeta", "algebraicnt"), ("tauceti:T/Zeta/Curves", "etale"), ("tauceti:T/Zeta/Weil", "unclassified"),
                     ("tauceti:T/Zeta/Weil/Purity", "unclassified"), ("tauceti:T/Fields", "analysis"),
                     links=[("tauceti:T/Zeta", "tauceti:T/Zeta/Weil/Purity"), ("tauceti:T/Zeta/Weil/Purity", "tauceti:T/Fields")])
        parents = {"tauceti:T/Zeta/Curves": "tauceti:T/Zeta", "tauceti:T/Zeta/Weil": "tauceti:T/Zeta", "tauceti:T/Zeta/Weil/Purity": "tauceti:T/Zeta/Weil"}
        for roadmap in map_["roadmaps"]:
            roadmap.update(origin="proposed", stages=[] if roadmap["id"] in ("tauceti:T/Zeta", "tauceti:T/Zeta/Weil") else ["layer"],
                           parentRoadmapId=parents.get(roadmap["id"]))
        found = categories_of(map_, {"tauceti:T/Zeta": "math.NT", "tauceti:T/Fields": "math.FA"}, area_categories(AREAS))
        self.assertEqual(found, {"tauceti:T/Zeta": ("math.NT", "declared"), "tauceti:T/Zeta/Curves": ("math.AG", "area"),
                                 "tauceti:T/Zeta/Weil": ("math.FA", "children"), "tauceti:T/Zeta/Weil/Purity": ("math.FA", "links"),
                                 "tauceti:T/Fields": ("math.FA", "declared")})


class Grouping(unittest.TestCase):
    """The map's galaxies become the arXiv categories, round Mathlib in a fixed order."""

    def test_each_category_is_a_galaxy_named_with_its_identifier_and_fields_go(self):
        map_ = atlas(("tauceti:Weil", "etale"), ("tauceti:Heights", "algebraicnt"), ("tauceti:Walks", "unclassified"))
        counts = group_by_arxiv(map_, {"tauceti:Weil": "math.AG", "tauceti:Heights": "math.NT"}, AREAS)
        self.assertEqual(counts, {"math.NT": 1, "math.AG": 1, UNCLASSIFIED: 1})
        groups = {group["id"]: group for group in map_["groups"]}
        self.assertEqual((groups["math.AG"]["label"], groups["math.AG"]["caption"], groups["math.AG"]["arxiv"]),
                         ("Algebraic Geometry (math.AG)", ["Algebraic Geometry", "math.AG"], "math.AG"))
        self.assertEqual((groups[UNCLASSIFIED]["label"], groups[UNCLASSIFIED]["arxiv"]), ("No arXiv category", None))
        self.assertEqual(map_["fields"], [])
        self.assertEqual({r["id"]: (r["group"], r["arxiv"]) for r in map_["roadmaps"]},
                         {"tauceti:Weil": ("math.AG", "math.AG"), "tauceti:Heights": ("math.NT", "math.NT"), "tauceti:Walks": (UNCLASSIFIED, None)})
        self.assertIn("metadata.toml declares", map_["roadmapClassification"]["roadmaps"]["tauceti:Weil"]["rationale"])

    def test_galaxies_are_contiguous_sectors_in_the_fixed_order_each_a_share_that_grows_with_it(self):
        self.assertEqual(ORDER[:2], ["math.NT", "math.AG"])
        self.assertEqual(ORDER[ORDER.index("math.RT") - 1:ORDER.index("math.RT") + 1], ["math.QA", "math.RT"])
        roadmaps = [(f"tauceti:N{i}", "x") for i in range(9)] + [("tauceti:G", "x"), ("tauceti:R", "x")]
        map_ = atlas(*roadmaps)
        group_by_arxiv(map_, {**{f"tauceti:N{i}": "math.NT" for i in range(9)}, "tauceti:G": "math.AG", "tauceti:R": "math.RT"})
        self.assertEqual([group["id"] for group in map_["groups"]], ["math.NT", "math.AG", "math.RT"])
        (a0, a1), (b0, b1), (c0, c1) = (group["sector"] for group in map_["groups"])
        # From the start, in order, a category gap apart, closing the circle with one more.
        self.assertEqual(a0, START)
        self.assertAlmostEqual(b0 - a1, FIELD_GAP, places=1)
        self.assertAlmostEqual(c0 - b1, FIELD_GAP, places=1)
        self.assertAlmostEqual(c1 + FIELD_GAP, START + 360, places=1)
        # Shares grow with the roadmaps: 9 ** .85 + 1 to 1 + 1.
        self.assertAlmostEqual((a1 - a0) / (b1 - b0), (9 ** .85 + 1) / 2, places=2)
        self.assertEqual(map_["groups"][0]["direction"], round((a0 + a1) / 2 % 360, 1))

    def test_a_category_mathlib_needs_is_on_the_map_with_no_roadmaps_yet(self):
        # The Mathlib disk's areas are everywhere on the map (the user, 2026-10-26): a category with Mathlib material but
        # no roadmaps keeps its place in the order, with the narrowest share, and no distance.
        map_ = atlas(("tauceti:N", "x"), ("tauceti:G", "x"))
        counts = group_by_arxiv(map_, {"tauceti:N": "math.NT", "tauceti:G": "math.AG"}, also=frozenset({"math.GN", "math.NT"}))
        self.assertEqual(counts, {"math.NT": 1, "math.AG": 1, "math.GN": 0})
        groups = {group["id"]: group for group in map_["groups"]}
        self.assertEqual([group["id"] for group in map_["groups"]], ["math.NT", "math.AG", "math.GN"])
        self.assertEqual((groups["math.GN"]["roadmapIds"], groups["math.GN"]["distance"], groups["math.GN"]["label"]),
                         ([], None, "General Topology (math.GN)"))
        (a0, a1), (b0, b1) = groups["math.AG"]["sector"], groups["math.GN"]["sector"]
        self.assertAlmostEqual((a1 - a0) / (b1 - b0), 2, places=2)  # 1 ** .85 + 1 to 0 + 1

    def test_one_division_for_the_roadmaps_and_mathlib_half_each(self):
        # The disk's slices are the map's (the user, 2026-10-26): a sector's share counts its roadmaps and Mathlib's
        # items in it half each, so an area Mathlib covers has room though its roadmaps are still to come.
        map_ = atlas(*[(f"tauceti:N{i}", "x") for i in range(9)], ("tauceti:G", "x"))
        counts = group_by_arxiv(map_, {**{f"tauceti:N{i}": "math.NT" for i in range(9)}, "tauceti:G": "math.AG"},
                                also=frozenset({"math.GN"}), mathlib={"math.NT/analytic": 50, "math.GN": 800})
        self.assertEqual(counts, {"math.NT": 9, "math.AG": 1, "math.GN": 0})
        roadmaps = {"math.NT": 9 ** .85 + 1, "math.AG": 1 ** .85 + 1, "math.GN": 1}
        mathlib = {"math.NT": 50 ** .85 + 1, "math.AG": 1, "math.GN": 800 ** .85 + 1}
        share = {gid: roadmaps[gid] / sum(roadmaps.values()) + mathlib[gid] / sum(mathlib.values()) for gid in roadmaps}
        width = {group["id"]: group["sector"][1] - group["sector"][0] for group in map_["groups"]}
        self.assertAlmostEqual(width["math.GN"] / width["math.NT"], share["math.GN"] / share["math.NT"], places=2)
        self.assertAlmostEqual(width["math.AG"] / width["math.NT"], share["math.AG"] / share["math.NT"], places=2)

    def test_what_uses_a_roadmap_is_counted_again_by_category(self):
        map_ = atlas(("tauceti:A", "x"), ("tauceti:B", "x"), ("tauceti:C", "x"), edges=[("tauceti:A", "tauceti:B"), ("tauceti:A", "tauceti:C")])
        map_["roadmapDistances"] = {"roadmaps": {"tauceti:A": {"distance": 3, "usedBy": [{"galaxy": "etale", "roadmaps": 9}]}}, "galaxies": {"etale": {}}}
        group_by_arxiv(map_, {"tauceti:A": "math.NT", "tauceti:B": "math.AG", "tauceti:C": "math.NT"})
        self.assertEqual(map_["roadmapDistances"]["roadmaps"]["tauceti:A"]["usedBy"], [{"galaxy": "math.AG", "roadmaps": 1}])
        self.assertEqual(map_["roadmapDistances"]["galaxies"], {})


SUBAREAS = {"least": 2, "order": {"math.NT": ["modular", "padic", "other"]},
            "first": {"math.NT": {"arithmetic statistics": "other"}},
            "categories": {"math.NT": [{"id": "padic", "label": "p-adic Hodge theory", "short": "p-adic", "phrases": ["p-adic hodge", "perfectoid*"]},
                                       {"id": "modular", "label": "Modular forms", "short": "Modular", "phrases": ["modular form*", "hecke"]},
                                       {"id": "other", "label": "Other number theory", "short": "Other", "phrases": []}]}}


class FinerAreas(unittest.TestCase):
    """The largest categories are divided into finer areas by the phrases their roadmaps' titles carry."""

    def roadmaps(self):
        return [{"id": "tauceti:A", "title": "`p`-adic Hodge theory"}, {"id": "tauceti:B", "title": "Perfectoid spaces"},
                {"id": "tauceti:C", "title": "Modular forms — Hecke theory"}, {"id": "tauceti:D", "title": "Galois groups", "summary": "Hecke operators act."},
                {"id": "tauceti:E", "title": "Arithmetic statistics of Hecke fields"}, {"id": "tauceti:F", "title": "Heights"}]

    def test_a_title_places_a_roadmap_else_its_summary_else_the_catch_all_in_the_order_round_the_map(self):
        parts = finer_areas(self.roadmaps(), "math.NT", SUBAREAS)
        self.assertEqual([(area["id"], rids) for area, rids in parts],
                         [("modular", ["tauceti:C", "tauceti:D"]), ("padic", ["tauceti:A", "tauceti:B"]), ("other", ["tauceti:E", "tauceti:F"])])

    def test_an_area_with_too_few_roadmaps_joins_the_catch_all_and_one_area_is_no_division(self):
        parts = finer_areas(self.roadmaps()[:3] + self.roadmaps()[5:], "math.NT", SUBAREAS)
        self.assertEqual([(area["id"], rids) for area, rids in parts], [("padic", ["tauceti:A", "tauceti:B"]), ("other", ["tauceti:C", "tauceti:F"])])
        self.assertEqual(finer_areas(self.roadmaps()[:2], "math.NT", SUBAREAS), [])
        self.assertEqual(finer_areas(self.roadmaps(), "math.AG", SUBAREAS), [])

    def test_a_divided_category_is_a_field_of_area_galaxies_with_closer_sectors(self):
        map_ = atlas(*[(roadmap["id"], "x") for roadmap in self.roadmaps()], ("tauceti:Weil", "etale"))
        for roadmap, given in zip(map_["roadmaps"], self.roadmaps()):
            roadmap.update(given)
        group_by_arxiv(map_, {**{roadmap["id"]: "math.NT" for roadmap in self.roadmaps()}, "tauceti:Weil": "math.AG"}, AREAS, SUBAREAS)
        self.assertEqual([group["id"] for group in map_["groups"]], ["math.NT/modular", "math.NT/padic", "math.NT/other", "math.AG"])
        self.assertEqual(map_["fields"], [{"id": "math.NT", "label": "Number Theory (math.NT)", "short": "Number Theory", "caption": ["Number Theory", "math.NT"],
                                           "code": "math.NT", "color": "#cfe3fb", "groupIds": ["math.NT/modular", "math.NT/padic", "math.NT/other"],
                                           "roadmaps": 6, "distance": 5.0}])
        modular = map_["groups"][0]
        self.assertEqual((modular["label"], modular["caption"], modular["field"], modular["arxiv"]), ("Modular forms", None, "math.NT", "math.NT"))
        self.assertEqual({r["id"]: (r["group"], r["area"]) for r in map_["roadmaps"]}["tauceti:C"], ("math.NT/modular", "modular"))
        sector = [group["sector"] for group in map_["groups"]]
        self.assertAlmostEqual(sector[1][0] - sector[0][1], AREA_GAP, places=1)
        self.assertAlmostEqual(sector[3][0] - sector[2][1], FIELD_GAP, places=1)


if __name__ == "__main__":
    unittest.main()
