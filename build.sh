#!/usr/bin/env bash
# Build the servable add-in into docs/ (GitHub Pages serves that folder).
#   BASE_URL=https://host/path ./build.sh     # default: GitHub Pages for this repo
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

BASE_URL="${BASE_URL:-https://b1tr0n1n.github.io/outlook-claude}"
BASE_URL="${BASE_URL%/}"
[[ $BASE_URL == https://* ]] || { echo "BASE_URL must be https:// (Outlook refuses plain http)" >&2; exit 1; }

[[ -f assets/icon-128.png ]] || python3 scripts/make-icons.py assets

rm -rf docs
mkdir -p docs/assets
cp src/*.html src/*.js src/*.css docs/
cp assets/*.png docs/assets/
cp vba/ClaudeOutlook.bas docs/
# COM add-in zip, packaged by com/build.sh (needs the .NET SDK, so it is built separately and committed).
cp com/dist/ClaudeOutlook-COM.zip docs/
sed "s#{{BASE}}#$BASE_URL#g" manifest.template.xml > docs/manifest.xml
cp docs/manifest.xml manifest.xml
touch docs/.nojekyll

echo "Built docs/ for $BASE_URL"
echo "Sideload: manifest.xml"
