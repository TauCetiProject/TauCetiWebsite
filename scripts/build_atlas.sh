#!/usr/bin/env bash
# Build the Tau Ceti Atlas into OUT/: the all-roadmaps page (index.html), the Tau Ceti-only page
# (tauceti/index.html), its areas as the map groups them (tauceti/areas.json, which the Roadmaps page reads)
# and the key-definitions listing (definitions.html).
#
# The Atlas's code lives here, in atlas/. Its research data does not: data/ and the parts of
# research/blueprint/ the build reads (about 530 MB) stay in cbirkbeck/tauceti-explorer, where the
# research pipeline maintains them. This checks them out sparsely into WORK/, lays atlas/'s code
# over them (scripts find the data relative to themselves), refreshes the Tau Ceti progress and
# open-PR snapshots the way the Atlas's scheduled job did, and builds.
#
# Usage: scripts/build_atlas.sh WORK OUT    (needs an authenticated gh for the open-PR listing)
set -euo pipefail

WORK=${1:?usage: build_atlas.sh WORK OUT}
OUT=${2:?usage: build_atlas.sh WORK OUT}
HERE=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)  # the build runs inside WORK, so a relative OUT would land there
DATA_REPO=${ATLAS_DATA_REPO:-https://github.com/cbirkbeck/tauceti-explorer.git}

if [ ! -d "$WORK/.git" ]; then
  git clone --quiet --depth 1 --filter=blob:none --sparse "$DATA_REPO" "$WORK"
  git -C "$WORK" sparse-checkout set data research/blueprint/papers research/blueprint/keydefs
else
  # A depth-1 checkout cannot merge the next one; take the tip as it is.
  git -C "$WORK" fetch --quiet --depth 1 origin HEAD
  git -C "$WORK" reset --quiet --hard FETCH_HEAD
fi

for d in src scripts vendor; do
  rm -rf "${WORK:?}/$d"
  cp -R "$HERE/atlas/$d" "$WORK/$d"
done

cd "$WORK"
# TAUCETI_PROGRESS: this run's progress.json from the site build, if there is one.
python3 scripts/tauceti_progress.py --fetch ${TAUCETI_PROGRESS:+--source "$TAUCETI_PROGRESS"} > /dev/null
python3 scripts/tauceti_prs.py --fetch > /dev/null
python3 scripts/build.py > /dev/null
python3 scripts/build.py --tauceti > /dev/null

mkdir -p "$OUT/tauceti"
cp index.html definitions.html "$OUT/"
cp tauceti/index.html tauceti/areas.json "$OUT/tauceti/"
python3 "$HERE/scripts/atlas_nav.py" "$OUT"
echo "built the atlas into $OUT"
