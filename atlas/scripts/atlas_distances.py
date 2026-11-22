"""Each roadmap's distance from Mathlib on the published pages, by the roadmaps it rests on.

A roadmap rests on every roadmap it builds on, and on everything those rest on in turn: its prerequisite
closure, over the prerequisites the READMEs name (scripts/roadmap_dependencies.py) and those the snapshot
declares. Its distance is the work still to do there, counted in roadmaps: each roadmap of the closure, itself
included, counts the share of its layers not yet done (half for a layer in progress), so a finished roadmap
counts nothing and a proposed one counts in full. The distances are placed on a 0-10 scale in proportion,
10 being the farthest roadmap on the page, so a roadmap resting on twice the work lies twice as far out.

The READMEs say some dependencies both ways: two roadmaps each naming the other, or a longer cycle. A
dependency is said more surely by its dependent's README than by its supplier's, in a dependency section than
in a sentence, by several READMEs than by one (each edge's `weight`); a link the snapshot declares is sure, and
one a pull request's description states (kind "pull") surer than anything the READMEs say against it.
Of two roadmaps naming each other, the direction said clearly more surely stays and an even pair goes; any
cycle left loses its least sure link. The links set aside stay on the map; only the distances leave them out.
"""
from __future__ import annotations

from collections import defaultdict

from roadmap_dependencies import DECLARED, STATED

# Of two roadmaps naming each other, a direction said this many times more surely stands.
CLEARLY = 1.5


def acyclic(weights: dict) -> set:
    """The (prerequisite, dependent) pairs kept once every cycle is broken: of a pair naming each other, the clearly
    surer direction, or neither; then, while a cycle remains, all but its least sure link."""
    keep = dict(weights)
    for (source, target), weight in weights.items():
        back = weights.get((target, source))
        if back is None or source > target:
            continue
        if weight >= CLEARLY * back:
            keep.pop((target, source), None)
        elif back >= CLEARLY * weight:
            keep.pop((source, target), None)
        else:
            keep.pop((source, target), None)
            keep.pop((target, source), None)
    while True:
        cycle = find_cycle(keep)
        if not cycle:
            return set(keep)
        del keep[min(cycle, key=lambda edge: (keep[edge], edge))]


def find_cycle(edges) -> list:
    """The links of one cycle of a directed graph given by its (source, target) pairs, or []."""
    succ = defaultdict(list)
    for source, target in sorted(edges):
        succ[source].append(target)
    state, parent = {}, {}
    for root in sorted(succ):
        if root in state:
            continue
        state[root], stack = 1, [(root, iter(succ[root]))]
        while stack:
            node, rest = stack[-1]
            following = next(rest, None)
            if following is None:
                state[node] = 2
                stack.pop()
            elif state.get(following) == 1:
                cycle, step = [following], node
                while step != following:
                    cycle.append(step)
                    step = parent[step]
                cycle.reverse()
                return [(cycle[i - 1], cycle[i]) for i in range(len(cycle))]
            elif following not in state:
                state[following], parent[following] = 1, node
                stack.append((following, iter(succ[following])))
    return []


def unfinished(atlas: dict) -> dict:
    """Each roadmap's share of its layers not yet done: a done layer counts 0, one in progress a half, any other 1.
    A finished roadmap (in Completed/) counts nothing."""
    statuses = {sid: (entry or {}).get("status") for sid, entry in atlas.get("progress", {}).get("stages", {}).items()}
    layers = defaultdict(list)
    for stage in atlas["stages"]:
        if not stage.get("expansion"):
            layers[stage["owner"]].append({"complete": 0.0, "in_progress": .5}.get(statuses.get(stage["id"]), 1.0))
    return {roadmap["id"]: 0.0 if roadmap.get("lifecycle") == "completed" else
            (sum(layers[roadmap["id"]]) / len(layers[roadmap["id"]]) if layers[roadmap["id"]] else 1.0)
            for roadmap in atlas["roadmaps"]}


def measure(atlas: dict) -> dict:
    """roadmap id -> its distance record: the distance, and what it rests on. A family (a roadmap with sub-roadmaps)
    also counts what it rests on as a whole, outside it (familyRestsOn): the roadmaps its index and its sub-roadmaps
    name as prerequisites, and what those rest on in turn over the links the distances keep.

    A family's index proposed in a pull request is a collection, with no layers: no roadmap rests on it. A sub-roadmap
    naming it names the family it belongs to, and what the family supplies comes from its sub-roadmaps, so it moves no
    other roadmap. Its links stay on the map."""
    ids = {roadmap["id"] for roadmap in atlas["roadmaps"]}
    indexes = {roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap.get("origin") == "proposed" and roadmap.get("stages") == []}
    weights = {}
    for edge in atlas.get("edges", []):
        if edge["source"] in ids and edge["target"] in ids and edge["source"] != edge["target"] and edge["source"] not in indexes:
            key = (edge["source"], edge["target"])
            kind = edge.get("kind")
            weights[key] = weights.get(key, 0) + ((edge.get("weight") or 0) if kind == "readme" else STATED if kind == "pull" else DECLARED)
    kept = acyclic(weights)
    for edge in atlas.get("edges", []):
        if (edge["source"], edge["target"]) in weights and (edge["source"], edge["target"]) not in kept:
            edge["cyclic"] = True
    prerequisites = defaultdict(set)
    for source, target in kept:
        prerequisites[target].add(source)
    left, proposed = unfinished(atlas), {roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap.get("origin") == "proposed"}
    work, rests, chain = {}, {}, {}
    for roadmap_id in sorted(ids):
        seen, stack = set(), list(prerequisites[roadmap_id])
        while stack:
            other = stack.pop()
            if other not in seen:
                seen.add(other)
                stack.extend(prerequisites[other])
        rests[roadmap_id] = seen
        work[roadmap_id] = left[roadmap_id] + sum(left[other] for other in seen)
    # The longest chain of unfinished roadmaps that ends at each roadmap, in an order where prerequisites come first.
    for roadmap_id in sorted(ids, key=lambda rid: len(rests[rid])):
        below = max((chain[other] for other in prerequisites[roadmap_id] if other in chain), default=0)
        chain[roadmap_id] = below + (1 if left[roadmap_id] > 0 else 0)
    top = max(work.values(), default=0) or 1.0
    below, outside = defaultdict(list), {}
    for roadmap in atlas["roadmaps"]:
        if roadmap.get("parentRoadmapId") in ids:
            below[roadmap["parentRoadmapId"]].append(roadmap["id"])
    for roadmap_id in sorted(below):
        family, stack = {roadmap_id}, list(below[roadmap_id])
        while stack:
            other = stack.pop()
            if other not in family:
                family.add(other)
                stack.extend(below[other])
        direct = {edge["source"] for edge in atlas.get("edges", []) if edge["target"] in family and edge["source"] in ids}
        outside[roadmap_id] = len(set().union(direct, *(rests[member] for member in family)) - family)
    return {roadmap_id: {"distance": round(10 * work[roadmap_id] / top, 2), "basis": "dependencies",
                         "structure": {"restsOn": len(rests[roadmap_id]), "proposed": len(rests[roadmap_id] & proposed), "unfinished": round(work[roadmap_id], 1),
                                       "prerequisites": len(prerequisites[roadmap_id]), "chain": chain[roadmap_id],
                                       **({"familyRestsOn": outside[roadmap_id]} if roadmap_id in outside else {})}}
            for roadmap_id in sorted(ids)}
