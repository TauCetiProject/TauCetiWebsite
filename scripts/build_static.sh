#!/usr/bin/env bash
# Generate the data taucetiproject.org has always published under /static/ (progress.json,
# pr-stats.json, pipeline-health.json, roadmap-completion.json, the chart SVGs), with the same
# generators TauCeti's old Pages build ran: TauCetiTools at the commit TauCeti pins, configured by
# TauCeti's own tauceti.toml and scripts/. Workers and other tools poll these paths, so the site
# serves them at /static/ as before.
#
#   scripts/build_static.sh TAUCETI_CLONE ROADMAP_CLONE OUT_DIR [CACHE_DIR]
#
# Both clones need full history. OUT_DIR should hold the previous run's files: a generator that
# fails leaves its last file in place. CACHE_DIR (default OUT_DIR/../cache) carries the
# pull-request snapshot between runs; without it the walk fetches every pull request's timeline,
# about 4,600 GraphQL requests, waiting out the rate limit as it goes. Needs GH_TOKEN or an
# authenticated gh. SKIP_PRS=1 skips the walk and what reads it (pull-request statistics, pipeline
# health, participation), for a local preview. Exits 1 if any generator failed, after running the rest.
set -uo pipefail

tauceti=$(cd "$1" && pwd)
roadmap=$(cd "$2" && pwd)
mkdir -p "$3" && out=$(cd "$3" && pwd)
cache=${4:-$out/../cache}
mkdir -p "$cache" && cache=$(cd "$cache" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=()
fail() { echo "::warning::$1 failed; keeping its previous files"; failures+=("$1"); }

# The pins TauCeti's own workflows use, so the generators match the policy files in its scripts/.
tools_ref=$(grep -ohE 'TauCetiTools/\.github/actions/setup@[0-9a-f]{40}' "$tauceti/.github/workflows/pages.yml" | head -1 | cut -d@ -f2)
review_ref=$(grep -A3 'repository: TauCetiProject/TauCetiReview' "$tauceti/.github/actions/checkout-merge-policy/action.yml" | grep -oE '[0-9a-f]{40}' | head -1)
[ -n "$tools_ref" ] || { echo "no TauCetiTools pin in TauCeti's pages.yml" >&2; exit 2; }

git clone --quiet --filter=blob:none https://github.com/TauCetiProject/TauCetiTools.git "$work/tools"
git -C "$work/tools" checkout --quiet "$tools_ref"
export PYTHONPATH="$work/tools${PYTHONPATH:+:$PYTHONPATH}"
# The generators import their shared modules from TauCeti's scripts/, as in TauCeti's own runs; the
# clone is scratch, so materializing into it is safe.
python3 -m tauceti_tools materialize "$work/shared" --conf "$tauceti/tauceti.toml" --policy-dir "$tauceti/scripts"
cp -a "$work/shared/." "$tauceti/scripts/"
if [ -n "$review_ref" ] && [ ! -d "$tauceti/.tauceti-review" ]; then
  git clone --quiet --filter=blob:none --no-checkout https://github.com/TauCetiProject/TauCetiReview.git "$tauceti/.tauceti-review" \
    && git -C "$tauceti/.tauceti-review" sparse-checkout set runner \
    && git -C "$tauceti/.tauceti-review" checkout --quiet "$review_ref" \
    || rm -rf "$tauceti/.tauceti-review"
fi
cd "$tauceti"

# Participation scans GitHub apart from the pull-request walk, so it runs alongside it.
skip=${SKIP_PRS:-}
participation=
if [ -z "$skip" ]; then
  (timeout 40m python3 scripts/participant_graph.py --out "$out/participation.svg" > "$work/participation.log" 2>&1 \
    || touch "$work/participation.failed") &
  participation=$!
fi

python3 scripts/loc_graph.py --repo . --ref HEAD --title "Tau Ceti — lines of Lean" --accent "#ff9d4d" \
  --out "$out/loc-tauceti.svg" --dump-data "$work/library-loc.json" TauCeti TauCeti.lean \
  && python3 scripts/roadmap_completion.py --roadmap-repo "$roadmap" --code-repo . \
       --code-data "$work/library-loc.json" --out-dir "$out" \
  || fail "lines of code and roadmap completion"

snapshot="$cache/pr-snapshot.json"
[ -n "$skip" ] || python3 scripts/pr_stats_graphs.py --repo TauCetiProject/TauCeti --roadmap-dir "$roadmap" --out-dir "$out" \
  --since-data "$snapshot" --dump-data "$snapshot" || fail "pull-request statistics"

if [ -s "$snapshot" ]; then
  python3 scripts/loc_roadmap_graph.py --data "$snapshot" --title "Tau Ceti — lines of Lean per roadmap" \
    --out "$out/loc-per-roadmap.svg" || fail "per-roadmap chart"
  verify=()
  [ -d .tauceti-review ] && verify=(--verify-readiness) || fail "merge readiness policy checkout"
  python3 scripts/pipeline_health.py --data "$snapshot" "${verify[@]}" --out "$out/pipeline-health.json" --json > /dev/null \
    || fail "pipeline health"
  data_arg=(--data "$snapshot")
else
  [ -n "$skip" ] || fail "pipeline health (no pull-request snapshot)"
  data_arg=()
fi

python3 scripts/roadmap_progress.py --roadmap-dir "$roadmap" --repo TauCetiProject/TauCeti "${data_arg[@]}" \
  --out "$out/progress.json" || fail "roadmap progress"

python3 scripts/ci_report_assets.py --out-dir "$out" || fail "CI charts"

if [ -n "$participation" ]; then
  wait "$participation"
  cat "$work/participation.log"
fi
if [ -e "$work/participation.failed" ]; then
  timeout 40m python3 scripts/participant_graph.py --out "$out/participation.svg" || fail "participation"
fi

for asset in $(python3 scripts/generated_assets.py); do
  [ -s "$out/$asset" ] || echo "::warning::static/$asset is absent"
done
if [ ${#failures[@]} -gt 0 ]; then
  echo "failed: ${failures[*]}"
  exit 1
fi
