#!/usr/bin/env bash
# Build the COM add-in and package com/dist/ClaudeOutlook-COM.zip (DLL + install/uninstall scripts).
# Low priority, one build node: this must never load the whole machine.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
export PATH="$HOME/.dotnet:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

nice -n 19 dotnet build ClaudeOutlook -c Release -m:1 -nodeReuse:false -v q
if [[ "${SKIP_TESTS:-}" != 1 ]]; then
  nice -n 19 dotnet test ClaudeOutlook.Tests -m:1 -nodeReuse:false -v q
fi

mkdir -p dist
python3 - <<'PY'
import zipfile
files = [("ClaudeOutlook/bin/Release/net48/ClaudeOutlook.dll", "ClaudeOutlook.dll"),
         ("installer/install.cmd", "install.cmd"),
         ("installer/uninstall.cmd", "uninstall.cmd"),
         ("installer/README.txt", "README.txt")]
with zipfile.ZipFile("dist/ClaudeOutlook-COM.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for src, name in files:
        info = zipfile.ZipInfo("ClaudeOutlook-COM/" + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, open(src, "rb").read())
PY
echo "Packaged com/dist/ClaudeOutlook-COM.zip"
