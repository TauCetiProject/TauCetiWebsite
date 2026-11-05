# Tau Ceti website

A static site for the [Tau Ceti](https://github.com/TauCetiProject/TauCeti) project, served on
GitHub Pages. Eight pages: home (what Tau Ceti is, how to use it from Lean), what's inside,
contribute, growth, roadmaps (structure and progress), people, acknowledgments, and internal health.
Two apps are served beside them:

- `atlas/` is the Tau Ceti Atlas, imported with its history from
  [cbirkbeck/tauceti-explorer](https://github.com/cbirkbeck/tauceti-explorer). Only its code is
  here. Its research data (`data/`, `research/`) stays in that repository, and
  `scripts/build_atlas.sh` checks out the part the build reads (about 530 MB) at deploy time. Its
  own workflows sit inert under `atlas/.github/`.
- `review/` is Tau Ceti Review's app (`web/`, its build, the sign-in worker and the browser check),
  imported with its history from
  [cbirkbeck/tauceti-reviewed-by-test](https://github.com/cbirkbeck/tauceti-reviewed-by-test). Its data
  and pipeline (the evidence store, the issue forms and intake, following Tau Ceti, Voyager, the
  datasets, the answerer) are a separate repository, `tauceti-review-data`, because they grow with Tau
  Ceti. That repository builds the site with this app and publishes it on its own Pages; the app here
  reads that `data/` (`REVIEW_DATA_URL`). The review's build and tests find the data repository through
  `TAU_REVIEW_DATA`, or a checkout beside this one.

`.github/workflows/pages.yml` deploys all three together, at `/`, `/atlas/` and `/review/`, once
the review app's tests pass against the data repository (`REVIEW_DATA_REPO`).

## How it works

- `src/layout.html` is the shared shell (nav, footer); `src/pages/*.html` are the page bodies.
  `scripts/build_site.py` puts them together into `_site/`.
- `scripts/build_static.sh` generates the data taucetiproject.org has always served under `/static/`
  (`progress.json`, `pr-stats.json`, `roadmap-completion.json`, `pipeline-health.json` and the chart
  SVGs) into `data/static/`, which the build copies to `static/`. Workers and other tools poll these
  paths. It runs the generators TauCeti's own Pages build ran: TauCetiTools at the commit TauCeti's
  workflows pin, configured by TauCeti's `tauceti.toml` and `scripts/`. The pull-request snapshot it
  keeps in `data/cache/` makes a warm run a handful of requests; a cold one walks every pull request,
  about 4,600 GraphQL requests.
- `scripts/build_data.py` generates the rest, into `data/`:
  - `library-loc.json`: lines under `TauCeti/` by day, from TauCeti's git history.
  - `loc-by-topic.json`: net lines per roadmap and per arXiv category, from merged pull requests
    and their `roadmap/<Area>` labels (bors merges included).
  - `examples.json`: the showcase theorems from TauCeti's `web/examples/Examples.lean`.
  - `ci-current.json`: running and queued CI jobs, and the CI service's current chart URLs. The CI
    manifest's CORS policy admits only taucetiproject.org, so it is copied at build time.
- The API documentation stays with TauCeti, whose `api-docs.yml` builds it alongside the library; the
  site links to it at `taucetiproject.github.io/TauCeti/docs/`. `404.html` sends the earlier site's
  addresses there (`/docs/…`) or to their pages here (`/about/`, `/team/`, `/statistics/`,
  `/progress/`, `/ci/`).
- `.github/workflows/pages.yml` regenerates `data/` and deploys every three hours. Both walks are
  cached between runs, with `data/`.

Charts are plain SVG drawn by `static/js/common.js`; there are no dependencies.

## Local preview

```bash
git clone https://github.com/TauCetiProject/TauCeti.git /tmp/TauCeti
git clone https://github.com/TauCetiProject/TauCetiRoadmap.git /tmp/TauCetiRoadmap
SKIP_PRS=1 scripts/build_static.sh /tmp/TauCeti /tmp/TauCetiRoadmap data/static   # needs an authenticated gh
python3 scripts/build_data.py --tauceti-repo /tmp/TauCeti
python3 scripts/build_site.py
python3 -m http.server -d _site 8765
```

The review app is always included, reading its data from `--review-data` (default
`$REVIEW_DATA_URL`). To include the Atlas, build it and pass its output:

```bash
scripts/build_atlas.sh /tmp/atlas-data /tmp/atlas-out
python3 scripts/build_site.py --atlas /tmp/atlas-out
```

`build_data.py --skip-prs` skips the pull-request walk; without `--tauceti-repo` it skips the
line-count history, and the growth page falls back to the chart in `static/`. `SKIP_PRS=1` leaves
out the pull-request walk and everything drawn from it (`pr-stats.json`, `pipeline-health.json`, the
contributor charts), so `build_data.py` also needs `--skip-prs` unless `data/static/` already has them.
