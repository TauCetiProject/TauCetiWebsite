"""The published atlas grouped by arXiv subject: one galaxy for each arXiv mathematics category.

Every Tau Ceti roadmap declares its category in its metadata.toml (`topic = "math.NT"`): the Progress
page passes it on for the roadmaps Tau Ceti has accepted, and a pull request's own metadata.toml gives
a proposed roadmap's. A roadmap that declares none takes the category of the nearest folder above it
that declares one; else of most of the roadmaps it is linked to (its prerequisites, the roadmaps that
use it and those its README names), when they clearly agree; else of the subject its title or README
names (data/tauceti-arxiv-areas.json, read backwards); else it waits in a galaxy of its own, "No arXiv
category", until its metadata.toml declares one.

The categories go round Mathlib in a fixed order, so that related subjects are neighbours (number
theory between representation theory and algebraic geometry, analysis beside PDE and probability).
Each galaxy is a contiguous sector of the circle (`sector`, in degrees), a share that grows with its
roadmaps, and the map lays each roadmap out in its sector as far from Mathlib as its distance
(src/universe.js). The largest categories are divided into finer areas (data/arxiv-subareas.json):
each area is then a galaxy, a sector within its category's, and the category is the field that
names them together.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict

# arXiv's mathematics categories, with arXiv's own descriptions, in their order round the map.
CATEGORIES = {
    "math.NT": ("Number Theory", "Prime numbers, diophantine equations, analytic number theory, algebraic number theory, arithmetic geometry, Galois theory."),
    "math.AG": ("Algebraic Geometry", "Algebraic varieties, stacks, sheaves, schemes, moduli spaces, complex geometry, quantum cohomology."),
    "math.AC": ("Commutative Algebra", "Commutative rings, modules, ideals, homological algebra, computational aspects, invariant theory, connections to algebraic geometry and combinatorics."),
    "math.RA": ("Rings and Algebras", "Non-commutative rings and algebras, non-associative algebras, universal algebra and lattice theory, linear algebra, semigroups."),
    "math.KT": ("K-Theory and Homology", "Algebraic and topological K-theory, relations with topology, commutative algebra, and operator algebras."),
    "math.CT": ("Category Theory", "Enriched categories, topoi, abelian categories, monoidal categories, homological algebra."),
    "math.AT": ("Algebraic Topology", "Homotopy theory, homological algebra, algebraic treatments of manifolds."),
    "math.GT": ("Geometric Topology", "Manifolds, orbifolds, polyhedra, cell complexes, foliations, geometric structures."),
    "math.GN": ("General Topology", "Continuum theory, point-set topology, spaces with algebraic structure, foundations, dimension theory, local and global properties."),
    "math.MG": ("Metric Geometry", "Euclidean, hyperbolic, discrete, convex, coarse geometry, comparisons in Riemannian geometry, symmetric spaces."),
    "math.DG": ("Differential Geometry", "Complex, contact, Riemannian, pseudo-Riemannian and Finsler geometry, relativity, gauge theory, global analysis."),
    "math.SG": ("Symplectic Geometry", "Hamiltonian systems, symplectic flows, classical integrable systems."),
    "math.MP": ("Mathematical Physics", "Applications of mathematics to problems in physics, and the mathematical methods those problems need."),
    "math.DS": ("Dynamical Systems", "Dynamics of differential equations and flows, mechanics, classical few-body problems, iterations, complex dynamics, delayed differential equations."),
    "math.AP": ("Analysis of PDEs", "Existence and uniqueness, boundary conditions, linear and non-linear operators, stability, soliton theory, integrable PDE's, conservation laws, qualitative dynamics."),
    "math.CA": ("Classical Analysis and ODEs", "Special functions, orthogonal polynomials, harmonic analysis, ODE's, differential relations, calculus of variations, approximations, expansions, asymptotics."),
    "math.CV": ("Complex Variables", "Holomorphic functions, automorphic group actions and forms, pseudoconvexity, complex geometry, analytic spaces, analytic sheaves."),
    "math.FA": ("Functional Analysis", "Banach spaces, function spaces, real functions, integral transforms, theory of distributions, measure theory."),
    "math.OA": ("Operator Algebras", "Algebras of operators on Hilbert space, C*-algebras, von Neumann algebras, non-commutative geometry."),
    "math.SP": ("Spectral Theory", "Schrödinger operators, operators on manifolds, general differential operators, numerical studies, integral operators, discrete models, resonances, non-self-adjoint operators, random operators and matrices."),
    "math.NA": ("Numerical Analysis", "Numerical algorithms for problems in analysis and algebra, scientific computation."),
    "math.OC": ("Optimization and Control", "Operations research, linear programming, control theory, systems theory, optimal control, game theory."),
    "math.PR": ("Probability", "Theory and applications of probability and stochastic processes: central limit theorems, large deviations, stochastic differential equations, models from statistical mechanics, queuing theory."),
    "math.ST": ("Statistics Theory", "Applied, computational and theoretical statistics: statistical inference, regression, time series, multivariate analysis, data analysis."),
    "math.IT": ("Information Theory", "Theoretical and experimental aspects of information theory and coding."),
    "math.CO": ("Combinatorics", "Discrete mathematics, graph theory, enumeration, combinatorial optimization, Ramsey theory, combinatorial game theory."),
    "math.LO": ("Logic", "Logic, set theory, point-set topology, formal mathematics."),
    "math.GR": ("Group Theory", "Finite groups, topological groups, representation theory, cohomology, classification and structure."),
    "math.QA": ("Quantum Algebra", "Quantum groups, skein theories, operadic and diagrammatic algebra, quantum field theory."),
    "math.RT": ("Representation Theory", "Linear representations of algebras and groups, Lie theory, associative algebras, multilinear algebra."),
    "math.HO": ("History and Overview", "Biographies, philosophy of mathematics, mathematics education, recreational mathematics, communication of mathematics."),
    "math.GM": ("General Mathematics", "Mathematical material of general interest, topics not covered elsewhere."),
}
UNCLASSIFIED = "unclassified"
UNCLASSIFIED_GROUP = ("No arXiv category", "Roadmaps whose metadata.toml declares no arXiv category yet, and that no folder above them, "
                      "no roadmap they are linked to and no subject their title names places.")
ORDER = list(CATEGORIES)
# The roadmaps no category places sit among the applied subjects, rather than between representation theory
# and number theory, which are neighbours.
ORDER.insert(ORDER.index("math.PR"), UNCLASSIFIED)
# Where the first sector starts, in degrees clockwise from the right; and the gaps between sectors.
START, FIELD_GAP, AREA_GAP = 40.0, 2.5, .8
# The colours of the subjects' families, as the atlas used them before.
COLOURS = {"math.NT": "#cfe3fb", "math.AG": "#e0f2e9", "math.KT": "#fce7f3", **dict.fromkeys(("math.AC", "math.RA", "math.GR"), "#dcd4f5"),
           **dict.fromkeys(("math.RT", "math.QA"), "#e7dcfa"), **dict.fromkeys(("math.CT", "math.LO", "math.HO", "math.GM"), "#e2e8f0"),
           **dict.fromkeys(("math.FA", "math.OA", "math.SP", "math.CA", "math.CV", "math.NA", "math.OC", "math.DS", "math.MP", "math.AP"), "#d8eafe"),
           **dict.fromkeys(("math.PR", "math.ST", "math.CO", "math.IT"), "#e6f0ff"),
           **dict.fromkeys(("math.AT", "math.GT", "math.GN", "math.DG", "math.SG", "math.MG"), "#d2f1e7"), UNCLASSIFIED: "#e2e8f0"}
NOTES = [
    "Each galaxy is one arXiv mathematics category. A roadmap sits in the category its metadata.toml declares; one that declares none takes its parent folder's, else that of most of the roadmaps it is linked to, else that of the subject its title names, else waits under \"No arXiv category\".",
    "The galaxies go round Mathlib in a fixed order of the categories, so related subjects are neighbours; a galaxy lies farther out the more theory its roadmaps must build.",
    "bridgeGroups lists up to three other categories joined to this one by the most prerequisite links.",
]


def category(value) -> str | None:
    """An arXiv mathematics category the map knows (`math.NT`; `math-ph` is math.MP), else None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return "math.MP" if value == "math-ph" else value if value in CATEGORIES else None


def area_categories(areas: dict) -> dict:
    """The arXiv category of each of the atlas's old subject areas: the category whose default it is, else the first
    that allows it (data/tauceti-arxiv-areas.json, read backwards)."""
    found = {}
    for code, entry in areas.items():
        if entry.get("default"):
            found.setdefault(entry["default"], code)
    for code, entry in areas.items():
        for area in entry.get("areas", []):
            found.setdefault(area, code)
    return found


def categories_of(atlas: dict, declared: dict, areas: dict | None = None) -> dict:
    """Each roadmap's (category, basis): "declared" in its metadata.toml; "parent" from the nearest folder above it
    that declares one (declared may name folders that are not on the map); "links" from a clear lead among the
    roadmaps it is linked to; "area" from the subject area its title or README named (areas maps an area to
    its category); or "none".

    A family's index proposed in a pull request (a collection: no layers of its own) comes last, in its own category or
    else that of most of its sub-roadmaps ("children"). It passes its category to none of them and counts in no other
    roadmap's place, so that the sub-roadmaps of a family stay in their own areas."""
    families = {roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap.get("origin") == "proposed" and roadmap.get("stages") == []}
    ids = [roadmap["id"] for roadmap in atlas["roadmaps"] if roadmap["id"] not in families]
    found = {rid: (code, "declared") for rid in ids if (code := category(declared.get(rid)))}
    for rid in ids:
        if rid in found:
            continue
        parts = rid.split("/")
        for end in range(len(parts) - 1, 0, -1):
            above = None if "/".join(parts[:end]) in families else category(declared.get("/".join(parts[:end])))
            if above:
                found[rid] = (above, "parent")
                break
    neighbours = defaultdict(list)
    for key in ("edges", "roadmapLinks"):
        for link in atlas.get(key, []):
            if link.get("source") != link.get("target"):
                neighbours[link.get("source")].append(link.get("target"))
                neighbours[link.get("target")].append(link.get("source"))

    def by_links(trusted):
        """Place each roadmap still unplaced whose linked roadmaps, among those placed on a trusted basis, clearly agree."""
        placed = {}
        for rid in ids:
            if rid not in found:
                ranked = Counter(found[other][0] for other in neighbours[rid] if other in found and found[other][1] in trusted).most_common(2)
                if ranked and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
                    placed[rid] = (ranked[0][0], "links")
        found.update(placed)
        return placed

    by_links({"declared", "parent"})
    for roadmap in atlas["roadmaps"]:
        code = (areas or {}).get(roadmap.get("group"))
        if roadmap["id"] not in found and roadmap["id"] not in families and code in CATEGORIES:
            found[roadmap["id"]] = (code, "area")
    # Roadmaps placed so far place their neighbours in turn: sub-roadmaps of an undeclared collection settle together.
    while by_links({"declared", "parent", "links", "area"}):
        pass
    below = defaultdict(list)
    for roadmap in atlas["roadmaps"]:
        below[roadmap.get("parentRoadmapId")].append(roadmap["id"])
    # The deepest first, so that a family inside a family is placed before the one above it.
    for rid in sorted(families, key=lambda rid: -rid.count("/")):
        ranked = Counter(found[other][0] for other in below[rid] if found.get(other, (UNCLASSIFIED,))[0] != UNCLASSIFIED).most_common(1)
        found[rid] = (code, "declared") if (code := category(declared.get(rid))) else (ranked[0][0], "children") if ranked else (UNCLASSIFIED, "none")
    return {roadmap["id"]: found.get(roadmap["id"], (UNCLASSIFIED, "none")) for roadmap in atlas["roadmaps"]}


def distance_of(atlas: dict, roadmap_id: str) -> float:
    """A roadmap's distance from Mathlib as the page reads it: measured, else classified, else 5."""
    measured = atlas.get("roadmapDistances", {}).get("roadmaps", {}).get(roadmap_id, {}).get("distance")
    classified = atlas.get("roadmapClassification", {}).get("roadmaps", {}).get(roadmap_id, {}).get("distance")
    return next((value for value in (measured, classified) if isinstance(value, (int, float))), 5)


def fold(text: str) -> str:
    """Lower case without accents, code marks or dash variants: the form finer-area phrases are matched in."""
    text = re.sub(r"[`*_]", "", text.lower()).replace("–", "-").replace("—", "-").replace("ℓ", "l")
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def phrase(text: str):
    """A finer area's phrase as a pattern: whole words, a hyphen and a space alike, and a final * for any ending."""
    body = re.escape(fold(text.rstrip("*"))).replace("\\-", "[- ]?").replace("\\ ", "[- ]?")
    return re.compile(r"(?<![a-z0-9])" + body + (r"[a-z]*" if text.endswith("*") else "") + r"(?![a-z0-9])")


def finer_areas(roadmaps: list, code: str, spec: dict) -> list:
    """[(area, roadmap ids)] for a category data/arxiv-subareas.json divides, in its order round the map; [] when the
    category is not divided, or only one of its areas has roadmaps."""
    areas = spec.get("categories", {}).get(code)
    if not areas:
        return []
    first = [(area, phrase(text)) for text, area in spec.get("first", {}).get(code, {}).items()]
    ordered = [(area["id"], [phrase(text) for text in area["phrases"]]) for area in areas]
    catch_all = areas[-1]["id"]

    def place(text):
        return next((area for area, pattern in first if pattern.search(text)), None) or \
            next((area for area, patterns in ordered if any(pattern.search(text) for pattern in patterns)), None)
    chosen = defaultdict(list)
    for roadmap in roadmaps:
        opening = " ".join((roadmap.get("summary") or "").split()[:40])
        chosen[place(fold(roadmap["title"])) or place(fold(opening)) or catch_all].append(roadmap["id"])
    for area in areas[:-1]:
        if 0 < len(chosen[area["id"]]) < spec.get("least", 1):
            chosen[catch_all] += chosen.pop(area["id"])
    by_id = {area["id"]: area for area in areas}
    parts = [(by_id[area], sorted(chosen[area])) for area in spec.get("order", {}).get(code) or list(by_id) if chosen.get(area)]
    return parts if len(parts) > 1 else []


def place_area(area: str | None, ids) -> str | None:
    """The galaxy a Mathlib area (math.GN, math.NT/analytic) falls in: its own when the map has it; else, for a finer
    area, its category's catch-all area, else the category itself; else none."""
    if not area:
        return None
    if area in ids:
        return area
    code = area.split("/")[0]
    return next((gid for gid in (f"{code}/other", code) if gid in ids), None)


def sectors(galaxies: list, mathlib: dict | None = None) -> None:
    """Give each galaxy its sector: [start, end] in degrees clockwise round Mathlib, contiguous and in order, a share
    that grows with its roadmaps, with a wider gap between categories than between the areas of one. Given the Mathlib
    disk's items in each galaxy (mathlib), the roadmaps and Mathlib share the circle half each, so that one division
    serves the disk round the sun and the map beyond it (the user, 2026-10-26)."""
    weight = {galaxy["id"]: len(galaxy["roadmapIds"]) ** .85 + 1 for galaxy in galaxies}
    if mathlib:
        items = {galaxy["id"]: mathlib.get(galaxy["id"], 0) ** .85 + 1 for galaxy in galaxies}
        roadmaps, disk = sum(weight.values()), sum(items.values())
        weight = {gid: weight[gid] / roadmaps + items[gid] / disk for gid in weight}
    gaps = [0.0] + [AREA_GAP if b.get("field") and b.get("field") == a.get("field") else FIELD_GAP for a, b in zip(galaxies, galaxies[1:])]
    unit = (360 - sum(gaps) - FIELD_GAP) / sum(weight.values())
    angle = START
    for gap, galaxy in zip(gaps, galaxies):
        angle += gap
        width = weight[galaxy["id"]] * unit
        galaxy["sector"] = [round(angle, 2), round(angle + width, 2)]
        galaxy["direction"] = round((angle + width / 2) % 360, 1)
        angle += width


def group_by_arxiv(atlas: dict, declared: dict, areas: dict | None = None, subareas: dict | None = None,
                   also: frozenset = frozenset(), mathlib: dict | None = None) -> dict:
    """Replace the atlas's subject galaxies with the arXiv categories, the largest divided into finer areas, and move
    every roadmap into its own.

    declared maps a roadmap id, or the id a folder off the map would have, to the category its metadata.toml
    declares; areas is data/tauceti-arxiv-areas.json's categories, and subareas data/arxiv-subareas.json. The
    categories in also join the map even with no roadmaps (the Mathlib disk's, scripts/disk_layout.py), with no
    distance. mathlib gives the disk's items in each of its areas; the sectors then share the circle between the
    roadmaps and Mathlib (sectors()). Returns {galaxy: roadmaps}."""
    chosen = categories_of(atlas, declared, area_categories(areas or {}))
    names = {**{code: name for code, (name, _) in CATEGORIES.items()}, UNCLASSIFIED: UNCLASSIFIED_GROUP[0]}
    descriptions = {**{code: text for code, (_, text) in CATEGORIES.items()}, UNCLASSIFIED: UNCLASSIFIED_GROUP[1]}
    members = defaultdict(list)
    for roadmap in atlas["roadmaps"]:
        code, basis = chosen[roadmap["id"]]
        roadmap["arxiv"] = code if code in CATEGORIES else None
        members[code].append(roadmap)
        name = names[code]
        rationale = {"declared": f"In {name} ({code}), the arXiv category its metadata.toml declares.",
                     "parent": f"In {name} ({code}), the arXiv category of the folder above it: it declares none of its own.",
                     "links": f"In {name} ({code}), the arXiv category of most of the roadmaps it is linked to: it declares none of its own.",
                     "area": f"In {name} ({code}), the arXiv category of the subject its title or README names: it declares none of its own.",
                     "children": f"In {name} ({code}), the arXiv category of most of its sub-roadmaps: it declares none of its own.",
                     "none": "It declares no arXiv category in a metadata.toml, and neither the folder above it, the roadmaps it is "
                             "linked to nor its title settle one."}[basis]
        record = atlas.setdefault("roadmapClassification", {}).setdefault("roadmaps", {}).setdefault(roadmap["id"], {})
        record.update(arxiv=code, arxivBasis=basis, rationale=rationale)
    mean = lambda rids: round(sum(distance_of(atlas, rid) for rid in rids) / len(rids), 2)
    galaxies, fields, about = [], [], {}
    for code in [code for code in ORDER if members[code] or code in also]:
        name, rids = names[code], sorted(roadmap["id"] for roadmap in members[code])
        parts = finer_areas(members[code], code, subareas or {})
        if not parts:
            galaxies.append({"id": code, "label": name if code == UNCLASSIFIED else f"{name} ({code})", "short": name,
                             "caption": ["No arXiv", "category yet"] if code == UNCLASSIFIED else [name, code],
                             "arxiv": code if code in CATEGORIES else None, "roadmapIds": rids})
            about[code] = descriptions[code]
            continue
        for area, area_rids in parts:
            galaxies.append({"id": f"{code}/{area['id']}", "label": area["label"], "short": area["short"], "caption": None,
                             "arxiv": code, "area": area["id"], "field": code, "roadmapIds": area_rids})
            about[f"{code}/{area['id']}"] = f"An area of {name} ({code}). {descriptions[code]}"
        fields.append({"id": code, "label": f"{name} ({code})", "short": name, "caption": [name, code], "code": code, "color": COLOURS[code],
                       "groupIds": [f"{code}/{area['id']}" for area, _ in parts], "roadmaps": len(rids), "distance": mean(rids)})
    ids = {galaxy["id"] for galaxy in galaxies}
    placed = Counter()
    for area, count in (mathlib or {}).items():
        if (gid := place_area(area, ids)):
            placed[gid] += count
    sectors(galaxies, dict(placed) if mathlib else None)
    for galaxy in galaxies:
        galaxy.update(color=COLOURS[galaxy["arxiv"] or UNCLASSIFIED], distance=mean(galaxy["roadmapIds"]) if galaxy["roadmapIds"] else None)
    group_of = {rid: galaxy["id"] for galaxy in galaxies for rid in galaxy["roadmapIds"]}
    area_of = {rid: galaxy.get("area") for galaxy in galaxies for rid in galaxy["roadmapIds"]}
    for roadmap in atlas["roadmaps"]:
        roadmap["group"], roadmap["area"] = group_of[roadmap["id"]], area_of[roadmap["id"]]
    links = defaultdict(Counter)
    for edge in atlas.get("edges", []):
        a, b = group_of.get(edge["source"]), group_of.get(edge["target"])
        if a and b and a != b:
            links[a][b] += 1
            links[b][a] += 1
    atlas["groups"] = galaxies
    atlas["meta"]["groupCount"] = len(galaxies)
    atlas["fields"] = fields
    atlas["regions"] = {
        "version": 4,
        "purpose": "arXiv subject galaxies and their finer areas: arXiv's description of each category and the galaxies it is most connected to.",
        "groups": {gid: {"description": text, "topics": [],
                         "bridgeGroups": [other for other, _ in sorted(links[gid].items(), key=lambda item: (-item[1], item[0]))[:3]]}
                   for gid, text in about.items()},
        "roadmapTags": {},
        "notes": NOTES,
    }
    # The measured distances name the old galaxies: what uses a roadmap is counted again by the new ones.
    distances = atlas.get("roadmapDistances", {})
    distances["galaxies"] = {}
    for rid, entry in distances.get("roadmaps", {}).items():
        if "usedBy" in entry and rid in group_of:
            users = Counter(group_of[edge["target"]] for edge in atlas.get("edges", [])
                            if edge["source"] == rid and edge["target"] in group_of and group_of[edge["target"]] != group_of[rid])
            entry["usedBy"] = [{"galaxy": gid, "roadmaps": count} for gid, count in sorted(users.items(), key=lambda item: (-item[1], item[0]))]
    return {galaxy["id"]: len(galaxy["roadmapIds"]) for galaxy in galaxies}
