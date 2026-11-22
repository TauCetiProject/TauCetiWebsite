import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from atlas_distances import acyclic, measure, unfinished  # noqa: E402


def atlas(edges, statuses=None, completed=()):
    """Roadmaps A..E of two layers each, every layer still to do unless statuses says otherwise."""
    names = sorted({name for edge in edges for name in edge[:2]} | set(completed) | set("ABE"))
    return {"roadmaps": [{"id": name, "lifecycle": "completed" if name in completed else "active"} for name in names],
            "stages": [{"id": f"{name}:{index}", "owner": name} for name in names for index in (1, 2)],
            "edges": [{"source": source, "target": target, "kind": "readme", "weight": weight} for source, target, weight in edges],
            "progress": {"stages": {sid: {"status": status} for sid, status in (statuses or {}).items()}}}


class Cycles(unittest.TestCase):
    """The READMEs say some dependencies both ways; the distances read them without cycles."""

    def test_of_two_roadmaps_naming_each_other_the_clearly_surer_direction_stays_an_even_pair_goes(self):
        self.assertEqual(acyclic({("A", "B"): 6, ("B", "A"): 2, ("C", "D"): 3, ("D", "C"): 3}), {("A", "B")})

    def test_a_longer_cycle_loses_its_least_sure_link(self):
        self.assertEqual(acyclic({("A", "B"): 5, ("B", "C"): 5, ("C", "A"): 1, ("C", "D"): 2}), {("A", "B"), ("B", "C"), ("C", "D")})


class Distances(unittest.TestCase):
    """A roadmap lies as far out as the unfinished work in what it rests on, and in itself."""

    def test_a_roadmap_counts_its_share_of_layers_not_yet_done(self):
        left = unfinished(atlas([], {"A:1": "complete", "B:1": "in_progress"}, completed=("C",)))
        self.assertEqual(left, {"A": .5, "B": .75, "C": 0.0, "E": 1.0})

    def test_the_distance_is_the_work_it_rests_on_in_proportion_to_the_farthest(self):
        # A <- B <- C, and D on its own; A is half done.
        out = measure(atlas([("A", "B", 3), ("B", "C", 3), ("D", "E", 3)], {"A:1": "complete"}))
        self.assertEqual({rid: out[rid]["structure"]["restsOn"] for rid in out}, {"A": 0, "B": 1, "C": 2, "D": 0, "E": 1})
        # C: .5 + 1 + 1 = 2.5, the farthest, at 10; B: 1.5; A: .5.
        self.assertEqual({rid: out[rid]["distance"] for rid in "ABC"}, {"A": 2.0, "B": 6.0, "C": 10.0})
        self.assertEqual((out["C"]["structure"]["chain"], out["C"]["structure"]["prerequisites"], out["C"]["basis"]), (3, 1, "dependencies"))

    def test_a_link_a_pull_request_states_outweighs_the_readmes_and_proposed_roadmaps_are_counted(self):
        map_ = atlas([("A", "B", 9), ("B", "A", 9)])
        map_["edges"][1]["kind"] = "pull"
        map_["roadmaps"][0]["origin"] = "proposed"
        out = measure(map_)
        self.assertEqual([edge.get("cyclic", False) for edge in map_["edges"]], [True, False])
        self.assertEqual((out["A"]["structure"]["restsOn"], out["A"]["structure"]["proposed"]), (1, 0))
        self.assertEqual((out["B"]["structure"]["restsOn"], out["B"]["structure"]["proposed"]), (0, 0))
        map_["roadmaps"][1]["origin"] = "proposed"
        self.assertEqual(measure(map_)["A"]["structure"]["proposed"], 1)

    def test_a_link_set_aside_to_break_a_cycle_is_marked_and_stays(self):
        map_ = atlas([("A", "B", 3), ("B", "A", 3)])
        out = measure(map_)
        self.assertEqual([edge.get("cyclic") for edge in map_["edges"]], [True, True])
        self.assertEqual(out["A"]["structure"]["restsOn"], 0)

    def family(self, origin):
        # F is a family's index, with no layers, above F/A and F/B. F/B's README names F, which reads as F being its
        # prerequisite; F names F/A among what it rests on. X and Y are outside the family.
        map_ = atlas([("X", "F/A", 3), ("F/A", "F", 3), ("F", "F/B", 3), ("Y", "F/B", 3)])
        map_["stages"] = [stage for stage in map_["stages"] if stage["owner"] != "F"]
        for roadmap in map_["roadmaps"]:
            roadmap.update(origin=origin, stages=[] if roadmap["id"] == "F" else [roadmap["id"] + ":1"],
                           parentRoadmapId="F" if roadmap["id"].startswith("F/") else None)
        return map_

    def test_no_roadmap_rests_on_a_proposed_familys_index_and_the_family_counts_what_it_rests_on(self):
        out = measure(self.family("proposed"))
        self.assertEqual({rid: out[rid]["structure"]["restsOn"] for rid in ("F", "F/A", "F/B")}, {"F": 2, "F/A": 1, "F/B": 1})
        # Outside the family: X and Y, through F/A and F/B.
        self.assertEqual(out["F"]["structure"]["familyRestsOn"], 2)
        self.assertNotIn("familyRestsOn", out["F/A"]["structure"])
        # A family on main keeps the links of its index: F/B rests on F, and through it on F/A and X.
        self.assertEqual(measure(self.family("tauceti"))["F/B"]["structure"]["restsOn"], 4)


if __name__ == "__main__":
    unittest.main()
