import math
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from arxiv_groups import place_area  # noqa: E402
from disk_layout import DISK_INNER, DISK_OUTER, SPACING, disk_sectors, layout, place_items, radius  # noqa: E402


def group(gid, a0, a1, field=None, label=None):
    return {"id": gid, "sector": [a0, a1], "field": field, "label": label or gid, "short": label or gid, "roadmapIds": []}


# Outer sectors as the map has them: number theory divided into areas, then algebraic geometry, an empty general
# topology and combinatorics.
GROUPS = [group("math.NT/analytic", 40, 90, "math.NT"), group("math.NT/other", 90.8, 130, "math.NT"), group("math.AG", 132.5, 190),
          group("math.GN", 192.5, 193.5), group("math.CO", 196, 220)]


class AreaSectors(unittest.TestCase):
    """The sector of the map an item's area falls in: its own when the map has it, else its category's."""

    def test_an_area_the_map_has_is_its_own_sector(self):
        ids = {g["id"] for g in GROUPS}
        self.assertEqual(place_area("math.NT/analytic", ids), "math.NT/analytic")
        self.assertEqual(place_area("math.GN", ids), "math.GN")

    def test_a_finer_area_the_map_lacks_goes_to_its_categorys_catch_all_else_the_category(self):
        self.assertEqual(place_area("math.NT/iwasawa", {g["id"] for g in GROUPS}), "math.NT/other")
        self.assertEqual(place_area("math.RT/lie", {"math.RT"}), "math.RT")
        self.assertIsNone(place_area("math.RT/lie", {"math.NT/other"}))


class Sectors(unittest.TestCase):
    """The disk's slices are the map's: every sector of the map, at its own angles, so that its dividing lines run on
    from the sun to the map's edge (the user, 2026-10-26); a slice may be empty on either side."""

    def setUp(self):
        self.disk = disk_sectors({"math.NT/analytic": 100, "math.NT/other": 310, "math.GN": 500, "math.CO": 50}, GROUPS)

    def test_every_sector_of_the_map_in_its_order(self):
        self.assertEqual([s["id"] for s in self.disk], [g["id"] for g in GROUPS])

    def test_at_the_maps_angles(self):
        for mine, theirs in zip(self.disk, GROUPS):
            self.assertEqual((mine["a0"], mine["a1"]), tuple(theirs["sector"]))

    def test_with_its_items_none_where_mathlib_has_none(self):
        self.assertEqual({s["id"]: s["items"] for s in self.disk},
                         {"math.NT/analytic": 100, "math.NT/other": 310, "math.AG": 0, "math.GN": 500, "math.CO": 50})


class Placement(unittest.TestCase):
    """Where an item lies: as far out as the Mathlib it needs, in its sector, clear of the others."""

    def test_the_radius_runs_from_the_inner_edge_to_the_rim_and_grows_with_what_is_needed(self):
        self.assertEqual(radius(0, 50_000), DISK_INNER)
        self.assertAlmostEqual(radius(50_000, 50_000), DISK_OUTER)
        values = [radius(n, 50_000) for n in (0, 1, 10, 100, 1000, 10_000, 50_000)]
        self.assertEqual(values, sorted(values))

    def test_items_stay_in_their_sector_and_apart(self):
        rng = random.Random(7)
        disk = disk_sectors({"math.GN": 400, "math.CO": 120}, [group("math.GN", 10, 60), group("math.CO", 62.5, 90)])
        items = [{"name": f"n{i}", "module": f"Mathlib.M{i % 17}", "sector": "math.GN" if i < 400 else "math.CO", "tier": 1 + (i % 3 == 0),
                  "importance": rng.random(), "needed": int(math.exp(rng.uniform(0, math.log(40_000))))} for i in range(520)]
        place_items(items, disk, 40_000)
        bounds = {s["id"]: (s["a0"], s["a1"]) for s in disk}
        for item in items:
            a0, a1 = bounds[item["sector"]]
            self.assertTrue(a0 <= item["a"] <= a1, item)
            self.assertTrue(DISK_INNER - SPACING * 6 <= item["r"] <= DISK_OUTER + SPACING * 6, item)
        where = [(i["sector"], i["r"] * math.cos(math.radians(i["a"])), i["r"] * math.sin(math.radians(i["a"]))) for i in items]
        close = sum(1 for k, (s, x, y) in enumerate(where) for (t, u, v) in where[k + 1:] if s == t and math.hypot(x - u, y - v) < SPACING - 1e-6)
        self.assertEqual(close, 0)


class Layout(unittest.TestCase):
    """What the page is given: the disk's sectors, its items with their places, and the dust by sector."""

    def test_the_pages_disk(self):
        disk = {"mathlib": "c0ffee", "measure": "…", "items": [
            {"name": "Nat.Prime", "title": "Prime number", "kind": "definition", "keyword": "def", "module": "Mathlib.Data.Nat.Prime.Defs",
             "path": "Mathlib/Data/Nat/Prime/Defs.lean", "line": 40, "area": "math.NT/other", "tier": 1, "catalogues": [["overview", "Number theory / Primes"]],
             "needed": 20, "stated": 8, "depth": 4, "importance": 9.1, "signature": "Nat.Prime (p : ℕ) : Prop", "summary": "A prime."},
            {"name": "CompactSpace", "title": "Compact space", "kind": "class", "keyword": "class", "module": "Mathlib.Topology.Defs", "path": "Mathlib/Topology/Defs.lean",
             "line": 9, "area": "math.GN", "tier": 2, "catalogues": [], "needed": 300, "stated": 50, "depth": 9, "importance": 5.0,
             "signature": "CompactSpace (X : Type u) [TopologicalSpace X] : Prop", "summary": ""}],
            "areas": {"math.NT/other": {"items": 1, "landmarks": 1}, "math.GN": {"items": 1, "landmarks": 0}},
            "dust": {"bins": 3, "max": 1000, "areas": {"math.NT/other": [1, 2, 3], "math.NT/iwasawa": [1, 0, 0], "math.GN": [0, 5, 0]}}}
        page = layout(disk, GROUPS)
        self.assertEqual((page["inner"], page["outer"], page["commit"], page["max"]), (DISK_INNER, DISK_OUTER, "c0ffee", 1000))
        self.assertEqual([(s["id"], s["items"]) for s in page["sectors"]],
                         [("math.NT/analytic", 0), ("math.NT/other", 1), ("math.AG", 0), ("math.GN", 1), ("math.CO", 0)])
        prime = next(i for i in page["items"] if i["n"] == "Nat.Prime")
        self.assertEqual((prime["id"], prime["t"], prime["s"], prime["l"], prime["p"], prime["q"], prime["d"]),
                         ("mathlib:Nat.Prime", "Prime number", "math.NT/other", 1, 20, 8, 4))
        self.assertEqual(page["dust"]["areas"], {"math.NT/other": [2, 2, 3], "math.GN": [0, 5, 0]})

    def test_a_type_says_how_many_of_its_files_instances_its_measures_take_in(self):
        witt = {"name": "WittVector", "title": "Ring of Witt vectors", "kind": "structure", "keyword": "structure",
                "module": "Mathlib.RingTheory.WittVector.Defs", "path": "Mathlib/RingTheory/WittVector/Defs.lean", "line": 45,
                "area": "math.NT/other", "tier": 1, "catalogues": [], "needed": 376, "stated": 40, "depth": 9, "importance": 8.5,
                "signature": "WittVector (p : ℕ) (R : Type u_1) : Type u_1", "summary": "", "structure": 14}
        prime = {**witt, "name": "Nat.Prime", "kind": "definition", "structure": 0}
        older = {key: value for key, value in witt.items() if key != "structure"} | {"name": "Older"}
        disk = {"mathlib": "c0ffee", "items": [witt, prime, older], "areas": {}, "dust": {"bins": 3, "max": 1000, "areas": {}}}
        items = {item["n"]: item for item in layout(disk, GROUPS)["items"]}
        self.assertEqual(items["WittVector"]["w"], 14)
        self.assertNotIn("w", items["Nat.Prime"])
        self.assertNotIn("w", items["Older"])   # a disk made before types took in their structure


if __name__ == "__main__":
    unittest.main()
