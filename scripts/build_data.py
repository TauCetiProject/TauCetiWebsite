#!/usr/bin/env python3
"""Generate the JSON this site draws beyond what scripts/build_static.sh generates into data/static/.

Writes into data/ (or --out):

  library-loc.json   lines of Lean under TauCeti/ by day, from the git history of main
  loc-by-topic.json  net lines of Lean per roadmap and per arXiv category, from merged pull requests
  roadmap-prs.json   per roadmap label: merged PRs, net lines of Lean and the twelve latest merges
  roadmap-examples.json  one headline declaration per completed roadmap (examples/roadmaps.json),
                     its statement as the API docs show it
  ci-current.json    the CI fleet's running and queued jobs, copied from the live manifest

Everything else the pages show (progress.json, pr-stats.json, roadmap-completion.json,
pipeline-health.json and the chart SVGs) is in data/static/, which build_static.sh writes first;
loc-by-topic.json reads progress.json and pr-stats.json from there. The CI manifest's CORS policy
admits only taucetiproject.org, so it is copied here at build time.

Usage:
  python3 scripts/build_data.py --tauceti-repo PATH [--out data] [--cache data/cache]

GH_TOKEN (or an authenticated `gh`) is needed for the pull-request walk: about 210 GraphQL
requests cold, a handful when --cache holds the previous run's snapshot.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import html
import urllib.request
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

OWNER, NAME = "TauCetiProject", "TauCeti"
CI_MANIFEST = "https://ci-data.taucetiproject.org/v1/ci/manifest.json"
BORS_PREFIX = "[Merged by Bors] - "

PR_QUERY = """
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, states: [MERGED, CLOSED],
                 orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state mergedAt closedAt updatedAt additions deletions
        labels(first: 20) { nodes { name } }
      }
    }
  }
}
"""


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def fetch_json(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers={"User-Agent": "tauceti-website-build", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "tauceti-website-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode()


def graphql(query: str, **variables) -> dict:
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        if v is not None:
            args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    for attempt in range(3):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0:
            return json.loads(p.stdout)["data"]
        log(f"graphql attempt {attempt + 1} failed: {p.stderr.strip()[:300]}")
    raise RuntimeError("GitHub GraphQL request failed three times")


def merged_at(pr: dict) -> str | None:
    """Bors closes the PRs it lands and renames them, so `mergedAt` alone misses most merges."""
    if pr.get("mergedAt"):
        return pr["mergedAt"]
    if pr.get("state") == "CLOSED" and pr.get("title", "").startswith(BORS_PREFIX):
        return pr.get("closedAt")
    return None


def walk_prs(cache_file: Path | None) -> list[dict]:
    known: dict[int, dict] = {}
    newest = None
    if cache_file and cache_file.exists():
        known = {pr["number"]: pr for pr in json.loads(cache_file.read_text())}
        newest = max((pr["updatedAt"] for pr in known.values()), default=None)
        log(f"cache: {len(known)} pull requests, newest update {newest}")
    # Ordered by update time, newest first, so a warm run stops at the first page that is
    # entirely older than what the cache already holds (with a day's overlap for clock skew).
    stop_before = None
    if newest:
        stop_before = (dt.datetime.fromisoformat(newest.replace("Z", "+00:00"))
                       - dt.timedelta(days=1)).isoformat().replace("+00:00", "Z")
    after, pages = None, 0
    while True:
        data = graphql(PR_QUERY, owner=OWNER, name=NAME, after=after)
        conn = data["repository"]["pullRequests"]
        pages += 1
        for node in conn["nodes"]:
            node["labels"] = [l["name"] for l in node["labels"]["nodes"]]
            known[node["number"]] = node
        if pages % 20 == 0:
            log(f"  {pages} pages, {len(known)} pull requests")
        oldest_here = conn["nodes"][-1]["updatedAt"] if conn["nodes"] else None
        if not conn["pageInfo"]["hasNextPage"]:
            break
        if stop_before and oldest_here and oldest_here < stop_before:
            break
        after = conn["pageInfo"]["endCursor"]
    log(f"walked {pages} pages; {len(known)} closed or merged pull requests known")
    prs = sorted(known.values(), key=lambda p: p["number"])
    if cache_file:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(prs, separators=(",", ":")))
    return prs


def day_range(first: dt.date, last: dt.date) -> list[str]:
    return [(first + dt.timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]


def last_full_day() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)


PR_SUFFIX = re.compile(r"\(#(\d+)\)$")


def lean_lines_by_pr(repo: Path) -> dict[int, int]:
    """Net lines of Lean under TauCeti/ that each pull request's squash commit on main added.

    Every PR lands as one first-parent commit whose subject ends "(#N)". A merged PR with no such
    commit touched no Lean under TauCeti/, and counts 0.
    """
    out = subprocess.run(
        ["git", "-C", str(repo), "log", "--first-parent", "--diff-merges=first-parent",
         "--numstat", "--format=@%s", "HEAD", "--", "TauCeti/*.lean", "TauCeti.lean"],
        capture_output=True, text=True, check=True).stdout
    net: dict[int, int] = defaultdict(int)
    pr = None
    for line in out.splitlines():
        if line.startswith("@"):
            m = PR_SUFFIX.search(line)
            pr = int(m.group(1)) if m else None
        elif line.strip() and pr is not None:
            a, d, _ = line.split("\t", 2)
            if a != "-":
                net[pr] += int(a) - int(d)
    return dict(net)


def pr_net(pr: dict, lean: dict[int, int] | None) -> int:
    """A PR's net lines of Lean, or of every file it changed when no TauCeti clone was given."""
    return lean.get(pr["number"], 0) if lean is not None else pr["additions"] - pr["deletions"]


def loc_by_topic(prs: list[dict], progress: dict, pr_stats: dict, lean: dict[int, int] | None) -> dict:
    """Net lines of Lean per roadmap label, by merge day.

    Same attribution as TauCeti's per-roadmap chart: a merged PR counts toward the one
    roadmap/<Area> label it carries; none or several leaves it unattributed. A line replaced by a
    later PR nets to zero there, so a roadmap's total is what its PRs added and kept, not the
    effort spent on it nor the current size of its files.
    """
    code_to_name = {}
    for row in progress.get("rows", []):
        if row.get("arxiv") and row.get("topic"):
            code_to_name[row["arxiv"]] = row["topic"]
    label_to_code = dict(pr_stats.get("by_roadmap_and_contributor", {}).get("roadmap_categories", {}))
    for row in progress.get("rows", []):
        label_to_code.setdefault(f"roadmap/{row['name']}", row.get("arxiv"))

    end = last_full_day()
    per_label_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    per_label_prs: dict[str, int] = defaultdict(int)
    unattributed = {"prs": 0, "net_lines": 0}
    first = None
    for pr in prs:
        when = merged_at(pr)
        if not when:
            continue
        day = when[:10]
        if day > end.isoformat():
            continue
        roadmap = [l for l in pr["labels"] if l.startswith("roadmap/")]
        net = pr_net(pr, lean)
        # `roadmap/none` and `roadmap/Unknown` are sentinels, not roadmaps: count them with the
        # unlabelled PRs, as taucetiproject.org's progress.json does.
        if len(roadmap) != 1 or not label_to_code.get(roadmap[0]):
            unattributed["prs"] += 1
            unattributed["net_lines"] += net
            continue
        per_label_day[roadmap[0]][day] += net
        per_label_prs[roadmap[0]] += 1
        first = min(first, day) if first else day

    dates = day_range(dt.date.fromisoformat(first), end) if first else []
    topic_series: dict[str, list[int]] = {}
    roadmaps = []
    for label, by_day in per_label_day.items():
        code = label_to_code[label]
        running, series = 0, []
        for d in dates:
            running += by_day.get(d, 0)
            series.append(running)
        acc = topic_series.setdefault(code, [0] * len(dates))
        for i, v in enumerate(series):
            acc[i] += v
        roadmaps.append({"label": label, "roadmap": label.removeprefix("roadmap/"),
                         "arxiv": code, "net_lines": running, "merged_prs": per_label_prs[label]})
    topics = [{"arxiv": code, "name": code_to_name.get(code, code), "series": series,
               "net_lines": series[-1] if series else 0,
               "roadmaps": sum(1 for r in roadmaps if r["arxiv"] == code)}
              for code, series in topic_series.items()]
    topics.sort(key=lambda t: -t["net_lines"])
    return {"generated_at": now_iso(), "last_full_day": end.isoformat(), "dates": dates,
            "topics": topics, "unattributed": unattributed,
            "merged_prs": sum(per_label_prs.values()) + unattributed["prs"],
            "lines": "lean" if lean is not None else "all files"}


ROADMAP_SENTINELS = {"roadmap/none", "roadmap/Unknown"}


def roadmap_prs(prs: list[dict], lean: dict[int, int] | None, recent: int = 12) -> dict:
    """Per roadmap label: merged PRs, their net lines, and the most recent merges, for the roadmap pages.

    A PR counts only when it carries exactly one roadmap/ label and that label is not a sentinel.
    """
    out: dict[str, dict] = {}
    merged: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for pr in prs:
        when = merged_at(pr)
        if not when:
            continue
        labels = [l for l in pr["labels"] if l.startswith("roadmap/")]
        if len(labels) != 1 or labels[0] in ROADMAP_SENTINELS:
            continue
        merged[labels[0]].append((when, pr))
    for label, items in sorted(merged.items()):
        items.sort(key=lambda x: x[0], reverse=True)
        out[label] = {
            "merged": len(items),
            "net_lines": sum(pr_net(pr, lean) for _, pr in items),
            "recent": [{"number": pr["number"], "title": pr["title"].removeprefix(BORS_PREFIX),
                        "merged": when[:10], "net": pr_net(pr, lean)}
                       for when, pr in items[:recent]],
        }
    return {"generated_at": now_iso(), "roadmaps": out}


def library_loc(repo: Path) -> dict:
    """Lines under TauCeti/ and TauCeti.lean on main at the end of each UTC day.

    Walks main's first-parent history and sums each commit's numstat against its first
    parent, which is the same tree TauCeti's own loc_graph.py counts.
    """
    out = subprocess.run(
        ["git", "-C", str(repo), "log", "--first-parent", "--diff-merges=first-parent",
         "--reverse", "--numstat", "--format=@%cI", "HEAD", "--", "TauCeti", "TauCeti.lean"],
        capture_output=True, text=True, check=True).stdout
    by_day: dict[str, int] = defaultdict(int)
    files_by_day: dict[str, int] = defaultdict(int)
    day = None
    for line in out.splitlines():
        if line.startswith("@"):
            day = dt.datetime.fromisoformat(line[1:]).astimezone(dt.timezone.utc).date().isoformat()
        elif line.strip() and day:
            a, d, path = line.split("\t", 2)
            if a == "-":
                continue
            by_day[day] += int(a) - int(d)
    end = last_full_day()
    first = dt.date.fromisoformat(min(by_day))
    dates = day_range(first, end)
    lines, running = [], 0
    for d in dates:
        running += by_day.get(d, 0)
        lines.append(running)
    files = subprocess.run(["git", "-C", str(repo), "ls-files", "TauCeti"], capture_output=True,
                           text=True, check=True).stdout.split()
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True,
                          text=True, check=True).stdout.strip()
    return {"generated_at": now_iso(), "commit": head, "last_full_day": end.isoformat(),
            "dates": dates, "lines": lines,
            "files_now": sum(1 for f in files if f.endswith(".lean"))}


def mathlib_baseline(repo: Path, cache: Path) -> dict:
    """Count the exact pinned source once per revision, without building Mathlib."""
    manifest = json.loads((repo / "lake-manifest.json").read_text())
    ref = next(p["rev"] for p in manifest["packages"] if p["name"] == "mathlib")
    if not re.fullmatch(r"[0-9a-f]{40}", ref):
        raise ValueError("Mathlib pin must be a full commit SHA")
    source = cache / "mathlib.git"
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "--bare", "--quiet", str(source)], check=True)
    git = ["git", "-C", str(source)]
    if subprocess.run(git + ["cat-file", "-e", ref + "^{commit}"], capture_output=True).returncode:
        subprocess.run(git + ["fetch", "--quiet", "--depth=1",
                              "https://github.com/leanprover-community/mathlib4.git", ref], check=True)
    counts = subprocess.run(git + ["grep", "-I", "-c", "^", ref, "--", ":(glob)Mathlib/**/*.lean", "Mathlib.lean"],
                            capture_output=True, text=True, check=True).stdout
    lines = sum(int(row.rsplit(":", 1)[1]) for row in counts.splitlines())
    if lines <= 0:
        raise ValueError("Mathlib comparison contains no lines")
    return {"generated_at": now_iso(), "ref": ref, "lines": lines}


DOCS = "https://taucetiproject.github.io/TauCeti/docs/"


VOID = {"br", "img", "input", "meta", "link", "hr", "wbr", "source", "col", "area", "base", "embed", "param", "track"}


class _Tree(HTMLParser):
    """A doc-gen4 page as nested [tag, attrs, children] lists, text as str children."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = ["#root", {}, []]
        self.open = [self.root]

    def handle_starttag(self, tag, attrs):
        node = [tag, dict(attrs), []]
        self.open[-1][2].append(node)
        if tag not in VOID:
            self.open.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.open) - 1, 0, -1):
            if self.open[i][0] == tag:
                del self.open[i:]
                break

    def handle_data(self, data):
        self.open[-1][2].append(data)


def _nodes(node, pred):
    if isinstance(node, str):
        return
    if pred(node):
        yield node
    for c in node[2]:
        yield from _nodes(c, pred)


def _has_class(cls):
    return lambda n: cls in (n[1].get("class") or "").split()


def _text(node) -> str:
    return node if isinstance(node, str) else "".join(_text(c) for c in node[2])


def _clean(node, base: str) -> str:
    """Escaped text, with <a href> (absolute) and <span> kept; every other element and attribute dropped."""
    if isinstance(node, str):
        return html.escape(node, quote=False)
    inner = "".join(_clean(c, base) for c in node[2])
    if node[0] == "a" and node[1].get("href"):
        return f'<a href="{html.escape(urljoin(base, node[1]["href"]))}">{inner}</a>'
    return inner


def _flow(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _type_lines(s: str) -> str:
    # doc-gen4 keeps the printer's line breaks as runs of spaces: n spaces are a break and n - 1 of indent.
    s = s.replace("\n", " ")
    return re.sub(r" {2,}", lambda m: "\n" + " " * (len(m.group(0)) - 1), s).strip()


def decl_header(decl: str, module: str) -> dict:
    url = DOCS + module.replace(".", "/") + ".html"
    tree = _Tree()
    tree.feed(fetch_text(url))
    decl_div = next(_nodes(tree.root, lambda n: n[0] == "div" and n[1].get("id") == decl and _has_class("decl")(n)), None)
    header = decl_div and next(_nodes(decl_div, _has_class("decl_header")), None)
    if header is None:
        raise LookupError(f"{decl} is not on {url}")
    kind = next(_nodes(header, _has_class("decl_kind")))
    name = next(_nodes(header, _has_class("decl_name")))
    args = [_flow(_clean(a, url)) for a in _nodes(header, _has_class("decl_args"))]
    typ = next(_nodes(header, _has_class("decl_type")), None)
    source = next((a[1]["href"] for a in _nodes(decl_div, lambda n: n[0] == "a")
                   if a[1].get("href", "").startswith("https://github.com/")), None)
    return {"kind": _flow(_text(kind)), "name": _flow(_text(name)), "args": [a for a in args if a and a != ":"],
            "type": _type_lines(_clean(typ, url)) if typ is not None else "", "docs": url + "#" + decl, "source": source}


def roadmap_examples() -> dict:
    """examples/roadmaps.json, each entry with its declaration's header from the API docs. A declaration the
    docs do not have (renamed, or newer than the docs) is left out with a warning."""
    picks = json.loads((Path(__file__).resolve().parent.parent / "examples" / "roadmaps.json").read_text())
    items = []
    for e in picks:
        try:
            items.append({**e, **decl_header(e["decl"], e["module"])})
        except Exception as err:
            log(f"::warning::example for {e['roadmap']}: {err}")
    return {"generated_at": now_iso(), "docs": DOCS, "examples": items}


RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$")


def latest_release(repo: Path) -> dict:
    """The newest release tag, the one the site tells a downstream project to pin.

    Tags follow Lean's: vX.Y.Z-rcN sorts before vX.Y.Z, and a tag's own lean-toolchain is
    read rather than assumed from its name.
    """
    def git(*a):
        return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True).stdout.strip()

    def key(tag):
        m = RELEASE_TAG.match(tag)
        return tuple(int(g) for g in m.groups()[:3]) + (int(m[4]) if m[4] else float("inf"),)

    tags = [t for t in git("tag", "--list", "v*").split() if RELEASE_TAG.match(t)]
    tag = max(tags, key=key)
    return {"generated_at": now_iso(), "tag": tag, "commit": git("rev-list", "-n1", tag),
            "date": git("for-each-ref", "--format=%(creatordate:short)", f"refs/tags/{tag}"),
            "toolchain": git("show", f"{tag}:lean-toolchain")}


def ci_current() -> dict:
    m = fetch_json(CI_MANIFEST, {"Origin": "https://taucetiproject.org"})
    cur = m.get("current") or {}
    return {"fetched_at": now_iso(), "generated_at": m.get("generated_at"),
            "mode": m.get("mode"), "running": cur.get("running", {}),
            "queued": cur.get("queued", {}), "github": m.get("github", {}),
            # Content-addressed chart URLs; images need no CORS, so pages can show them directly.
            "assets": {name: "https://ci-data.taucetiproject.org" + a["url"]
                       for name, a in (m.get("assets") or {}).items() if a.get("url")}}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write(out: Path, name: str, obj) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / name).write_text(json.dumps(obj, separators=(",", ":")))
    log(f"wrote {out / name} ({(out / name).stat().st_size:,} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tauceti-repo", type=Path, help="a full (non-shallow) clone of TauCeti at main")
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--cache", type=Path, default=Path("data/cache"))
    ap.add_argument("--skip-prs", action="store_true", help="leave loc-by-topic.json and roadmap-prs.json as they are")
    args = ap.parse_args()

    failures = []

    def step(name, fn):
        try:
            fn()
        except Exception as e:  # one failed source keeps the previous file, not the whole build
            log(f"::warning::{name} failed: {e}")
            failures.append(name)

    if args.tauceti_repo:
        step("library-loc", lambda: write(args.out, "library-loc.json", library_loc(args.tauceti_repo)))
        step("mathlib-baseline", lambda: write(args.out, "mathlib-baseline.json", mathlib_baseline(args.tauceti_repo, args.cache)))
        step("release", lambda: write(args.out, "release.json", latest_release(args.tauceti_repo)))
    step("roadmap-examples", lambda: write(args.out, "roadmap-examples.json", roadmap_examples()))
    step("ci-current", lambda: write(args.out, "ci-current.json", ci_current()))
    if not args.skip_prs:
        def topics():
            progress = json.loads((args.out / "static" / "progress.json").read_text())
            pr_stats = json.loads((args.out / "static" / "pr-stats.json").read_text())
            prs = walk_prs(args.cache / "prs.json")
            lean = lean_lines_by_pr(args.tauceti_repo) if args.tauceti_repo else None
            write(args.out, "loc-by-topic.json", loc_by_topic(prs, progress, pr_stats, lean))
            write(args.out, "roadmap-prs.json", roadmap_prs(prs, lean))
        step("loc-by-topic", topics)
    if failures:
        log(f"failed: {', '.join(failures)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
