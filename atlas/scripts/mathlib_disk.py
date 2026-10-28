#!/usr/bin/env python3
"""Mathlib's key definitions and theorems for the disk, from the Mathlib dataset (the release the workflow
mathlib-dataset.yml publishes), Mathlib's catalogues and its files' headers at the same commit.

  .venv/bin/python scripts/mathlib_disk.py --dataset DIR --source MATHLIB_DIR [--out data/mathlib-disk.json]

The landmarks are the declarations Mathlib's catalogues name (docs/overview.yaml, docs/undergrad.yaml, docs/100.yaml,
docs/1000.yaml), titled in the catalogues' words; the rest of the items are the main definitions and results its files
list in their headers ("## Main definitions", "## Main results", …). Each is placed by its module's area
(data/mathlib-areas.json) and measured by how much of Mathlib it needs (measures()). Needs requirements-data.txt;
the page's build does not.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from evidence_core.catalogs import famous_theorems, topic_tree
from evidence_core.graphs import is_machinery

from mathlib_areas import area_of, load_rules

ROOT = Path(__file__).resolve().parents[1]

# The catalogues, in the order their titles are preferred: the famous theorems' own titles before a subject tree's.
LISTS = (("100", "100.yaml"), ("1000", "1000.yaml"))
TREES = (("overview", "overview.yaml"), ("undergrad", "undergrad.yaml"))
MAIN_HEADING = re.compile(r"^##\s+(?:main|key)\b[^\n]*?(?:definition|result|statement|theorem|declaration|construction)", re.I | re.M)
SECTION_HEADING = re.compile(r"^##\s", re.M)
BULLET = re.compile(r"^\s{0,3}[*-]\s+(.*)$")
LEADING_NAME = re.compile(r"\s*`([^`]+)`\s*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+)?")
NAME = re.compile(r"[^\s`,:()\[\]{}]+")


TEX = {r"\Z": "ℤ", r"\Q": "ℚ", r"\R": "ℝ", r"\C": "ℂ", r"\N": "ℕ", r"\varphi": "φ", r"\phi": "φ", r"\varepsilon": "ε",
       r"\epsilon": "ε", r"\pi": "π", r"\zeta": "ζ", r"\lambda": "λ", r"\mu": "μ", r"\sigma": "σ", r"\ell": "ℓ",
       r"\infty": "∞", r"\cdot": "·", r"\lVert": "‖", r"\rVert": "‖", r"\|": "‖", r"\to": "→", r"\le": "≤", r"\ge": "≥"}
BLACKBOARD = {"Z": "ℤ", "Q": "ℚ", "R": "ℝ", "C": "ℂ", "N": "ℕ", "F": "𝔽", "K": "𝕂", "A": "𝔸", "P": "ℙ"}
CALLIGRAPHIC = {"S": "𝒮", "L": "ℒ", "O": "𝒪", "F": "ℱ", "C": "𝒞", "H": "ℋ"}
SUPERSCRIPT = dict(zip("0123456789ndkpimx+-", "⁰¹²³⁴⁵⁶⁷⁸⁹ⁿᵈᵏᵖⁱᵐˣ⁺⁻"))
SUBSCRIPT = dict(zip("0123456789pinkjmx", "₀₁₂₃₄₅₆₇₈₉ₚᵢₙₖⱼₘₓ"))


def plain_tex(text: str) -> str:
    """The TeX of a catalogue's title ($\\Z/n\\Z$, $L^p$) as plain Unicode (ℤ/nℤ, Lᵖ): a label on the map cannot typeset."""
    def maths(m: re.Match) -> str:
        s = m.group(1)
        s = re.sub(r"\\mathbb\{(\w)\}", lambda b: BLACKBOARD.get(b.group(1), b.group(1)), s)
        s = re.sub(r"\\mathcal\{(\w)\}", lambda c: CALLIGRAPHIC.get(c.group(1), c.group(1)), s)
        s = re.sub(r"\\math(?:rm|bf|it|sf)\{([^}]*)\}", r"\1", s)
        for macro, symbol in sorted(TEX.items(), key=lambda item: -len(item[0])):
            s = re.sub(re.escape(macro) + r"(?![A-Za-z])", symbol, s)
        s = s.replace("{", "").replace("}", "")
        s = re.sub(r"\^(\S)", lambda u: SUPERSCRIPT.get(u.group(1), "^" + u.group(1)), s)
        return re.sub(r"_(\S)", lambda d: SUBSCRIPT.get(d.group(1), "_" + d.group(1)), s)
    return re.sub(r"\$([^$]*)\$", maths, text)


def _title(text: str) -> str:
    """A subject tree's leaves are lower case ("complete metric space"): the first letter goes up."""
    text = plain_tex(text)
    return text[:1].upper() + text[1:] if text[:1].islower() else text


def catalogue_entries(docs: Path) -> dict[str, dict]:
    """Each declaration a catalogue names: {"title", "catalogues": [[catalogue, where]]}, where is a subject tree's
    "Area / Subarea" or a famous theorem's title. The title is the first famous list's that names it, else the first
    subject tree's."""
    found: dict[str, dict] = {}

    def add(name: str, title: str, where: list[str], rank: int) -> None:
        entry = found.setdefault(name, {"title": title, "catalogues": [], "rank": rank})
        if where not in entry["catalogues"]:
            entry["catalogues"].append(where)
        if rank < entry["rank"]:
            entry["title"], entry["rank"] = title, rank

    for rank, (key, file) in enumerate(LISTS):
        if (docs / file).exists():
            for entry in famous_theorems(docs / file):
                for name in entry.decls:
                    add(name, plain_tex(entry.title), [key, plain_tex(entry.title)], rank)

    def walk(topic, path: list[str], key: str, rank: int) -> None:
        for entry in topic.entries:
            for name in entry.decls:
                add(name, _title(entry.title), [key, plain_tex(" / ".join(path))], rank)
        for child in topic.children:
            walk(child, path + [child.title], key, rank)

    for rank, (key, file) in enumerate(TREES, start=len(LISTS)):
        if (docs / file).exists():
            walk(topic_tree(docs / file), [], key, rank)
    for entry in found.values():
        del entry["rank"]
    return found


def module_name(root: Path, path: Path) -> str:
    return ".".join(path.relative_to(root).with_suffix("").parts)


def _bullets(section: str) -> list[str]:
    """The text of each bullet of a section, its indented continuation lines joined to it."""
    out: list[str] = []
    for line in section.splitlines():
        m = BULLET.match(line)
        if m and not line.startswith("    "):
            out.append(m.group(1).strip())
        elif out and line.strip() and line[:1].isspace():
            out[-1] += " " + line.strip()
        elif not line.strip() and out:
            out.append("")
    return [text for text in out if text]


def header_names(docstring: str) -> list[tuple[str, str]]:
    """(name, the bullet's words) for each name a Main section's bullets start with."""
    out: list[tuple[str, str]] = []
    for heading in MAIN_HEADING.finditer(docstring):
        following = SECTION_HEADING.search(docstring, heading.end())
        for text in _bullets(docstring[heading.end():following.start() if following else len(docstring)]):
            names, at = [], 0
            while m := LEADING_NAME.match(text, at):
                names.append(m.group(1).strip())
                at = m.end()
            words = re.sub(r"^\s*[:—–-]\s*", "", text[at:]).strip()
            out += [(name, words) for name in names if NAME.fullmatch(name)]
    return out


def header_entries(root: Path) -> dict[str, list[tuple[str, str]]]:
    """For each module under root/Mathlib, the names its header's Main sections list, with their words."""
    found: dict[str, list[tuple[str, str]]] = {}
    for path in sorted((root / "Mathlib").rglob("*.lean")):
        text = path.read_text(encoding="utf-8", errors="replace")
        start = text.find("/-!")
        if start < 0:
            continue
        end = text.find("-/", start)
        names = header_names(text[start + 3:end if end > 0 else len(text)])
        if names:
            found[module_name(root, path)] = names
    return found


def resolve(written: str, module: str, names: set[str], by_module: dict[str, list[str]]) -> str | None:
    """The declaration a header means by a name: the name itself, else the one declaration of its module whose
    name ends with it (a header writes `span` for `Submodule.span`), else none."""
    if written in names:
        return written
    ending = [name for name in by_module.get(module, ()) if name.endswith("." + written)]
    return ending[0] if len(ending) == 1 else None


# --- how much of Mathlib a declaration needs --------------------------------------------------------------------
# A closure is counted exactly while it is small, and by a HyperLogLog sketch of REGISTERS registers once it is not
# (about 3% error, ample for the disk's logarithmic scale): each declaration's closure is the union of its
# dependencies' closures, so the sketches merge register by register, in one pass in dependency order.
P_BITS = 10
REGISTERS = 1 << P_BITS
EXACT = 128
ALPHA = .7213 / (1 + 1.079 / REGISTERS)
_M64 = np.uint64(0xFFFFFFFFFFFFFFFF)


def _hashes(ids: np.ndarray) -> np.ndarray:
    """splitmix64 of each id: well-spread 64-bit hashes."""
    with np.errstate(over="ignore"):
        z = np.asarray(ids, dtype=np.int64).astype(np.uint64) + np.uint64(0x9E3779B97F4A7C15)
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        return (z ^ (z >> np.uint64(31))) & _M64


def _bit_length(w: np.ndarray) -> np.ndarray:
    n = np.zeros(w.shape, dtype=np.int64)
    for s in (32, 16, 8, 4, 2, 1):
        high = w >= (np.uint64(1) << np.uint64(s))
        n[high] += s
        w = np.where(high, w >> np.uint64(s), w)
    return n + (w > 0)


def _slots(ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each id's register and rank (the leading zeros of the rest of its hash, plus one)."""
    h = _hashes(ids)
    rest = 64 - P_BITS
    return (h >> np.uint64(rest)).astype(np.int64), (rest - _bit_length(h & np.uint64((1 << rest) - 1)) + 1).astype(np.uint8)


def registers_for(ids: np.ndarray) -> np.ndarray:
    """The sketch of a set of declaration ids."""
    regs = np.zeros(REGISTERS, dtype=np.uint8)
    if len(ids):
        index, rank = _slots(np.asarray(ids))
        np.maximum.at(regs, index, rank)
    return regs


def estimate(regs: np.ndarray) -> float:
    """How many distinct ids a sketch holds (linear counting while many registers are empty)."""
    zeros = int(np.count_nonzero(regs == 0))
    raw = ALPHA * REGISTERS * REGISTERS / float(np.sum(np.ldexp(1.0, -regs.astype(np.int64))))
    return REGISTERS * math.log(REGISTERS / zeros) if raw <= 2.5 * REGISTERS and zeros else raw


def _postorder(nodes, children) -> list[int]:
    """The nodes, each after everything beneath it; an edge back to a node still being visited is not followed."""
    state: dict[int, int] = {}
    order: list[int] = []
    for root in nodes:
        if root in state:
            continue
        state[root] = 1
        stack = [(root, iter(children(root)))]
        while stack:
            x, it = stack[-1]
            for c in it:
                if c not in state:
                    state[c] = 1
                    stack.append((c, iter(children(c))))
                    break
            else:
                stack.pop()
                state[x] = 2
                order.append(x)
    return order


def _counts(order: list[int], children, counted, extra=None) -> dict[int, int]:
    """For each node, in an order with everything beneath a node before it: how many counted nodes lie beneath it,
    itself excluded. A closure (itself included when counted) is a set while it has at most EXACT members, else a
    sketch. `extra` maps a node to others whose closures its count takes in too (a type's structure, structures());
    only that node's own count changes, not the closures of what lies above it."""
    small: dict[int, frozenset] = {}
    big: dict[int, np.ndarray] = {}
    count: dict[int, int] = {}
    for x in order:
        kids = [c for c in children(x) if c in small or c in big]
        exact = [small[c] for c in kids if c in small]
        if len(exact) == len(kids):
            ids = frozenset().union(*exact)
            count[x] = len(ids)
            if len(ids) <= EXACT:
                small[x] = ids | {x} if counted(x) else ids
                continue
            regs = registers_for(np.fromiter(ids, dtype=np.int64, count=len(ids)))
        else:
            sketches = [big[c] for c in kids if c in big]
            regs = np.max(np.stack(sketches), axis=0) if len(sketches) > 1 else sketches[0].copy()
            if exact:
                ids = frozenset().union(*exact)
                np.maximum(regs, registers_for(np.fromiter(ids, dtype=np.int64, count=len(ids))), out=regs)
            count[x] = round(estimate(regs))
        if counted(x):
            index, rank = _slots(np.array([x]))
            regs[index[0]] = max(regs[index[0]], rank[0])
        big[x] = regs
    for x, more in (extra or {}).items():
        parts = [p for p in (x, *more) if p in small or p in big]
        ids = frozenset().union(*(small[p] for p in parts if p in small))
        sketches = [big[p] for p in parts if p in big]
        if not sketches:
            count[x] = len(ids - {x})
            continue
        regs = np.max(np.stack(sketches), axis=0)
        if ids:
            np.maximum(regs, registers_for(np.fromiter(ids, dtype=np.int64, count=len(ids))), out=regs)
        count[x] = max(count.get(x, 0), round(estimate(regs)) - (1 if counted(x) else 0))
    return count


# A statement's brackets, which a binder's colon and arrows inside them do not end.
OPENING, CLOSING = "([{⦃⟨", ")]}⦄⟩"


def _after_last(text: str, separator: str) -> str:
    """What follows the last separator outside brackets (all of the text when there is none)."""
    depth, cut = 0, 0
    for i, c in enumerate(text):
        if c in OPENING:
            depth += 1
        elif c in CLOSING:
            depth -= 1
        elif depth == 0 and text.startswith(separator, i):
            cut = i + len(separator)
    return text[cut:]


def makes_a_type(signature: str) -> bool:
    """Whether a statement, as Lean prints it, ends in a universe (`WittVector (p : ℕ) (R : Type u_1) : Type u_1`,
    `TruncatedWittVector : ℕ → ℕ → Type u_2 → Type u_2`): not a predicate's Prop, nor a function's values."""
    return re.match(r"(Type|Sort)\b", _after_last(_after_last(" ".join(signature.split()), " : "), " → ")) is not None


def structures(ds, excluded) -> dict[int, list[int]]:
    """Each type's structure, as its own module gives it: the instances declared there whose statements mention it and
    that carry data (operations, a ring, an order, a topology, a category). Mathlib often defines a type bare and gives
    it its structure so: `WittVector p R` is a sequence in R, and its ring operations, which need `Fact p.Prime` and
    `CommRing R`, are instances beside it. A Prop-valued instance is a theorem about the type (`IsDomain (Polynomial
    R)`) and is left out. A type is a structure, definition or inductive type whose statement ends in a universe; a
    class is a structure itself and keeps its own measures."""
    signature, mentions = ds.facet("signature"), ds.reverse("statement")
    found: dict[int, list[int]] = {}
    for d in ds.decls:
        if excluded[d.id] or d.kind not in ("structure", "definition", "inductive"):
            continue
        own = [i for i in mentions.get(d.id, ()) if ds.decls[i].kind == "instance" and not ds.decls[i].is_prop
               and ds.decls[i].module == d.module and not excluded[i]]
        if own and makes_a_type((signature.get(d.name) or [{}])[0].get("text") or ""):
            found[d.id] = own
    return found


@dataclass
class Measures:
    """Per declaration id: the Mathlib definitions needed to state and prove it (`needed`), to state it (`stated`),
    and the longest chain of definitions beneath it, itself included when it is one (`depth`). A definition is a
    concept of evidence-core's graphs: a definition, structure, class or inductive type, not a proof or instance. A
    type's measures take in the structure its file gives it, the `structure` instances (structures())."""
    needed: np.ndarray
    stated: np.ndarray
    depth: np.ndarray
    excluded: np.ndarray
    structure: np.ndarray


def measures(ds, g, rules) -> Measures:
    """The measures of every declaration of the library (the dataset's project, Mathlib). Lean's own declarations,
    and the tactics' (evidence-core's machinery, and the modules the area table leaves out), are neither counted nor
    gone through."""
    rules = sorted(rules, key=lambda rule: -len(rule[0].split(".")))
    n = len(ds.decls)
    excluded = np.array([not d.is_project or is_machinery(d.name) or area_of(d.module, rules) is None for d in ds.decls])
    concept = np.frombuffer(bytes(g.concept), dtype=np.uint8).astype(bool) & ~excluded
    nodes = [d.id for d in ds.decls if not excluded[d.id]]
    term = ds.edges("term")
    below_cache: dict[int, tuple[int, ...]] = {}

    def below(x: int) -> tuple[int, ...]:
        """The concepts a declaration's statement is about, or a concept is built from."""
        if x not in below_cache:
            found = g.built_from(x) if g.concept[x] else g.about(x)
            below_cache[x] = tuple(c for c in found if c != x and concept[c])
        return below_cache[x]

    def uses(x: int) -> list[int]:
        return [t for t in term.get(x, ()) if t != x and not excluded[t]]

    structure = structures(ds, excluded)
    needed = _counts(_postorder(nodes, uses), uses, lambda x: bool(concept[x]), structure)
    order = _postorder(nodes, below)
    stated = _counts(order, below, lambda x: bool(concept[x]), structure)
    depth = np.zeros(n, dtype=np.int32)
    for x in order:
        depth[x] = (1 if concept[x] else 0) + max((int(depth[c]) for c in below(x)), default=0)
    for x, own in structure.items():
        beneath = max((int(depth[c]) for i in own for c in below(i) if c != x), default=0)
        depth[x] = max(int(depth[x]), (1 if concept[x] else 0) + beneath)
    as_array = lambda values: np.array([values.get(i, 0) for i in range(n)], dtype=np.int32)
    return Measures(needed=as_array(needed), stated=as_array(stated), depth=depth, excluded=excluded,
                    structure=as_array({x: len(own) for x, own in structure.items()}))


# --- the data file -------------------------------------------------------------------------------------------------
SUMMARY = 400
BINS = 40
MEASURE = ("needed: the distinct Mathlib definitions, structures, classes and inductive types in the closure of everything a "
           "declaration's statement and proof refer to, the proofs of the lemmas it uses included, itself excluded; stated: "
           "the same over its statement alone (instances gone through by their type); depth: the longest chain of definitions "
           "beneath it, itself included when it is one. Lean's own declarations and the tactics' lemmas are not counted. "
           "A type (a structure, definition or inductive type, not a class) is measured with the structure its own file "
           "gives it: the instances declared there that mention it and carry data, such as its operations; Prop-valued "
           "ones are theorems about it and do not count.")


def clip(text: str, limit: int = SUMMARY) -> str:
    """Whole words, at most limit characters, with an ellipsis when cut."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[:limit - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def plain_signature(text: str) -> str:
    """A signature without its universe parameters, as the docs show it."""
    return re.sub(r"^(\S+?)\.\{[^}]*\}", r"\1", text)


def disk_data(ds, g, m: Measures, source: Path, rules) -> dict:
    """The disk's items (the catalogues' landmarks, tier 1, and the headers' main declarations, tier 2) with their
    words, measures and areas; the dust, every definition and result of the library by area and measure; and what
    was dropped: names the dataset lacks (by catalogue or header) and those the area table leaves out."""
    names = set(ds.by_name)
    by_module: dict[str, list[str]] = defaultdict(list)
    for d in ds.decls:
        if d.is_project:
            by_module[d.module].append(d.name)
    dropped: Counter = Counter({"catalogue": 0, "header": 0, "excluded": 0})
    chosen: dict[str, dict] = {}

    def usable(name, kind) -> bool:
        d = ds.by_name.get(name) if name else None
        if d is None or not d.is_project:
            dropped[kind] += 1
            return False
        if m.excluded[d.id]:
            dropped["excluded"] += 1
            return False
        return True

    for name, entry in catalogue_entries(source / "docs").items():
        if usable(name, "catalogue"):
            chosen[name] = {"tier": 1, "title": entry["title"], "catalogues": entry["catalogues"], "words": ""}
    for module, listed in header_entries(source).items():
        for written, words in listed:
            name = resolve(written, module, names, by_module)
            if name in chosen:
                chosen[name]["words"] = chosen[name]["words"] or words
            elif usable(name, "header"):
                chosen[name] = {"tier": 2, "title": name, "catalogues": [], "words": words}
    signature, docstring, located = ds.facet("signature"), ds.facet("docstring"), ds.facet("source")
    items = []
    for name, choice in chosen.items():
        d = ds.by_name[name]
        doc = ((docstring.get(name) or [{}])[0].get("text") or "").strip().split("\n\n")[0]
        words = [choice["words"], doc] if choice["tier"] == 2 else [doc, choice["words"]]
        where = (located.get(name) or [{}])[0]
        items.append({"name": name, "title": choice["title"], "kind": d.kind, "keyword": where.get("keyword") or d.kind,
                      "module": d.module, "path": where.get("path"), "line": (where.get("start") or [None])[0],
                      "area": area_of(d.module, rules), "tier": choice["tier"], "catalogues": choice["catalogues"],
                      "needed": int(m.needed[d.id]), "stated": int(m.stated[d.id]), "depth": int(m.depth[d.id]),
                      "structure": int(m.structure[d.id]), "importance": round(float(g.importance[d.id]), 2),
                      "signature": plain_signature(((signature.get(name) or [{}])[0].get("text") or "")),
                      "summary": clip(next((w for w in words if w), ""))})
    items.sort(key=lambda item: (item["tier"], -item["importance"], item["name"]))
    population = [d.id for d in ds.decls if not m.excluded[d.id] and (g.concept[d.id] or g.result[d.id])]
    top = max((int(m.needed[i]) for i in population), default=0)
    dust: dict[str, list[int]] = {}
    for i in population:
        area = area_of(ds.decls[i].module, rules)
        at = 0 if top == 0 else min(BINS - 1, int(BINS * math.log1p(int(m.needed[i])) / math.log1p(top)))
        dust.setdefault(area, [0] * BINS)[at] += 1
    areas: dict[str, dict] = {}
    for item in items:
        entry = areas.setdefault(item["area"], {"items": 0, "landmarks": 0})
        entry["items"] += 1
        entry["landmarks"] += item["tier"] == 1
    return {"version": 1, "mathlib": ds.commit, "extractor": ds.producer(), "measure": MEASURE, "items": items,
            "areas": dict(sorted(areas.items())), "dust": {"bins": BINS, "max": top, "areas": dict(sorted(dust.items()))},
            "dropped": dict(dropped)}


def write(data: dict, path: Path) -> None:
    """One item per line, so that a change shows as the lines it touches."""
    head = {key: value for key, value in data.items() if key != "items"}
    lines = ",\n".join(json.dumps(item, ensure_ascii=False, separators=(",", ":")) for item in data["items"])
    text = json.dumps(head, ensure_ascii=False, indent=1)
    path.write_text(text[:-2] + ',\n "items": [\n' + lines + "\n ]\n}\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    from evidence_core.dataset import Dataset
    from evidence_core.graphs import Graphs
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, required=True, help="the Mathlib dataset (an unpacked release of mathlib-dataset.yml)")
    parser.add_argument("--source", type=Path, required=True, help="Mathlib's source at the dataset's commit")
    parser.add_argument("--areas", type=Path, default=ROOT / "data" / "mathlib-areas.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "mathlib-disk.json")
    args = parser.parse_args(argv)
    start = time.time()
    ds = Dataset.load(args.dataset)
    g = Graphs(ds)
    rules = load_rules(args.areas)
    print(f"{len(ds.decls):,} declarations at {ds.commit[:12]} ({time.time() - start:.0f}s)", flush=True)
    m = measures(ds, g, rules)
    print(f"measured ({time.time() - start:.0f}s)", flush=True)
    data = disk_data(ds, g, m, args.source, rules)
    write(data, args.out)
    tiers = Counter(item["tier"] for item in data["items"])
    print(f"{tiers[1]:,} landmarks and {tiers[2]:,} header items in {len(data['areas'])} areas; dropped {data['dropped']}; "
          f"the deepest declaration needs {data['dust']['max']:,} ({time.time() - start:.0f}s) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
