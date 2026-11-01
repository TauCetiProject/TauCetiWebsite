#!/usr/bin/env python3
"""Put the site's top bar above the built Atlas. Run by scripts/build_atlas.sh on its output; safe to run
twice. The Atlas is dark only, so the bar stays dark there and has no theme switch.

Usage: python3 scripts/atlas_nav.py ATLAS_DIR
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_site import site_header  # noqa: E402

# The Atlas fills the viewport below its own header (--header); these move that space, and the panels it
# fixes below its header, down by the bar's height.
ATLAS_NAV_STYLE = ("<style>:root{--sitebar:49px}.site-nav{position:relative}.site-nav .theme-toggle{display:none}"
                   ".app-layout{height:calc(100dvh - var(--header) - var(--sitebar))}"
                   ".inspector,.catalogue-open .sidebar{top:calc(var(--header) + var(--sitebar))}</style>")


def atlas_nav(atlas: Path) -> None:
    version = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")
    for page, root in ((atlas / "index.html", "../"), (atlas / "tauceti" / "index.html", "../../")):
        if not page.exists():
            continue
        text = page.read_text(encoding="utf-8")
        if 'class="site-nav"' in text:
            continue
        if "<body>" not in text or "</head>" not in text:
            print(f"warning: no <head> or <body> in {page}; left without the site's bar")
            continue
        head = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&display=swap">'
                f'<link rel="stylesheet" href="{root}static/sitebar.css?v={version}">'
                f'<script src="{root}static/js/sitebar.js?v={version}" defer></script>' + ATLAS_NAV_STYLE)
        text = text.replace("</head>", head + "</head>", 1).replace("<body>", "<body>\n" + site_header("atlas/", root), 1)
        page.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    atlas_nav(Path(sys.argv[1]))
