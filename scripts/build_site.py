#!/usr/bin/env python3
"""Assemble the static site into _site/: each src/pages/*.html inside src/layout.html,
plus static/ and the generated data/.

A page begins with a JSON comment giving its title, description, page scripts and the data files its
figures draw on (linked from the footer, for download):

  <!-- {"title": "Growth", "description": "...", "scripts": ["growth.js"], "data": ["live:progress.json"]} -->

"live:NAME" is taucetiproject.org's published static/NAME; anything else is a path in this site.

Usage: python3 scripts/build_site.py [--out _site] [--data data]
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The top bar: a plain link (label, href), or a group (label, [(label, href), ...]) that opens as a
# dropdown. Every page in src/pages is built; the footer links the same pages.
NAV = [
    ("Home", "index.html"),
    ("Library", [("Overview", "contents.html"), ("Roadmaps", "structure.html"), ("Examples", "examples.html"), ("Atlas", "atlas/"),
                 ("Review", "review/"), ("API docs", "https://taucetiproject.org/docs/")]),
    ("Contribute", [("Start in one paste", "contribute.html#start"), ("Run a worker", "contribute.html#worker"),
                    ("Run a fleet", "contribute.html#fleet"), ("Shape the roadmaps", "contribute.html#roadmap"),
                    ("Review pull requests", "contribute.html#review"),
                         ("Check statements", "contribute.html#statements")]),
    ("Project", [("Growth", "growth.html"), ("People", "people.html"), ("Health", "health.html"),
                 ("Acknowledgments", "acknowledgments.html")]),
    ("FAQ", "faq.html"),
]
# A page reached through another one in the bar is shown as that one.
SECTION = {"roadmap.html": "structure.html"}

# Tau Ceti Review's data is built and published by the review data repository. Until that repository's
# Pages are up, the review's existing site serves the same data/.
REVIEW_DATA = "https://cbirkbeck.github.io/tauceti-reviewed-by-test/data/"

HEADER = re.compile(r"\A\s*<!--\s*(\{.*?\})\s*-->\s*", re.S)
LIVE = "https://taucetiproject.org/static/"

# Before first paint, so a reader who chose light never sees the dark page flash. The review app reads
# the same key (review/web/index.html).
THEME_INIT = ("  <script>try { var t = localStorage.getItem('tauceti:theme'); "
              "if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}</script>")


def site_header(current: str, root: str = "") -> str:
    """src/header.html for the page `current` (a file in src/pages, or review/), its links relative to `root`.
    The group holding the current page is marked current; the page itself is aria-current in its menu."""
    current = SECTION.get(current, current)

    def href(target: str) -> str:
        if target.startswith("http"):
            return target
        return (root or "./") if target == "index.html" else root + target

    def page_of(target: str) -> str:
        return target.split("#")[0]

    out = []
    for i, (label, target) in enumerate(NAV):
        if isinstance(target, str):
            here = ' aria-current="page"' if page_of(target) == current else ""
            out.append(f'          <a class="nav-top" href="{href(target)}"{here}>{html.escape(label)}</a>')
            continue
        mine = any(page_of(t) == current for _, t in target)
        items = []
        for sub, t in target:
            here = ' aria-current="page"' if page_of(t) == current and "#" not in t else ""
            ext = ' rel="noopener"' if t.startswith("http") else ""
            items.append(f'              <li><a href="{href(t)}"{here}{ext}>{html.escape(sub)}'
                         + (' <span aria-hidden="true">↗</span>' if t.startswith("http") else "") + "</a></li>")
        out.append(
            f'          <div class="nav-group{" current" if mine else ""}">\n'
            f'            <button class="nav-top" type="button" aria-expanded="false" aria-controls="nav-menu-{i}">'
            f'{html.escape(label)}<svg class="caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">'
            f'<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n'
            f'            <ul class="nav-menu" id="nav-menu-{i}">\n' + "\n".join(items) + "\n            </ul>\n          </div>")
    nav = "\n".join(out)
    return (ROOT / "src/header.html").read_text().replace("{{nav}}", nav).replace("{{home}}", root or "./").replace("{{root}}", root).rstrip("\n")


def data_links(files: list[str]) -> str:
    if not files:
        return ""
    links = []
    for f in files:
        url = LIVE + f.removeprefix("live:") if f.startswith("live:") else f
        links.append(f'<a href="{html.escape(url)}" download>{html.escape(url.rsplit("/", 1)[-1])}</a>')
    return ("        <p class=\"small muted data-links\">The data behind this page, to download: "
            + " · ".join(links) + ".</p>")


def review_app(out: Path, data_url: str, version: str) -> None:
    """The review app from review/web/, reading its data/ from data_url (review/web/data.js), under the
    site's own top bar (its stylesheet scopes the bar; review/web/style.css places its own bar below)."""
    shutil.copytree(ROOT / "review" / "web", out)
    index = out / "index.html"
    page = index.read_text()
    assert "<head>" in page and "<body>" in page, "review/web/index.html has no <head> or <body>"
    head = "\n".join([
        f'<meta name="tau-review-data" content="{html.escape(data_url.rstrip("/") + "/")}">',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&display=swap">',
        f'<link rel="stylesheet" href="../static/sitebar.css?v={version}">',
        f'<script src="../static/js/sitebar.js?v={version}" defer></script>',
    ])
    page = page.replace("<head>", "<head>\n" + head, 1).replace("<body>", "<body>\n" + site_header("review/", "../"), 1)
    index.write_text(page)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "_site")
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--atlas", type=Path, help="the Atlas as scripts/build_atlas.sh built it, copied to atlas/")
    ap.add_argument("--review-data", default=os.environ.get("REVIEW_DATA_URL") or REVIEW_DATA,
                    help="where Tau Ceti Review's built data/ is published (default $REVIEW_DATA_URL, else %(default)s)")
    args = ap.parse_args()

    layout = (ROOT / "src/layout.html").read_text()
    now = dt.datetime.now(dt.timezone.utc)
    version = now.strftime("%Y%m%d%H%M%S")

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    shutil.copytree(ROOT / "static", args.out / "static")
    if args.data.exists():
        shutil.copytree(args.data, args.out / "data", ignore=shutil.ignore_patterns("cache"))
    (args.out / ".nojekyll").write_text("")
    if args.atlas:
        shutil.copytree(args.atlas, args.out / "atlas")
    review_app(args.out / "review", args.review_data, version)
    # Files for agents (start.md), served from the site root.
    for f in sorted((ROOT / "src/agent").glob("*")):
        shutil.copy(f, args.out / f.name)

    pages = sorted(p.name for p in (ROOT / "src/pages").glob("*.html"))
    for file in pages:
        src = (ROOT / "src/pages" / file).read_text()
        m = HEADER.match(src)
        meta = json.loads(m.group(1)) if m else {}
        body = src[m.end():] if m else src
        scripts = "\n".join(f'  <script src="static/js/{s}?v={version}" defer></script>'
                            for s in meta.get("scripts", []))
        title = meta.get("title", "Tau Ceti")
        page = (layout
                .replace("{{title}}", html.escape(title if title == "Tau Ceti" else f"{title} — Tau Ceti"))
                .replace("{{description}}", html.escape(meta.get("description", "")))
                .replace("{{scripts}}", scripts)
                .replace("{{theme_init}}", THEME_INIT)
                .replace("{{header}}", site_header(file))
                .replace("{{data_links}}", data_links(meta.get("data", [])))
                .replace("{{page}}", file.removesuffix(".html"))
                .replace("{{version}}", version)
                .replace("{{content}}", body)
                .replace("{{review_data}}", html.escape(args.review_data.rstrip("/") + "/")))
        (args.out / file).write_text(page)
    print(f"built {len(pages)} pages into {args.out}")


if __name__ == "__main__":
    main()
