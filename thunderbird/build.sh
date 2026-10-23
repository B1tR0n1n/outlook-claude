#!/usr/bin/env bash
# Package thunderbird/dist/claude-thunderbird.xpi. The prompts, API client, styles and icons are
# the Outlook add-in's own files, copied in, so both stay in step.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

[[ -f ../assets/icon-128.png ]] || python3 ../scripts/make-icons.py ../assets

mkdir -p dist
python3 - <<'PY'
import zipfile
files = [(f, f) for f in ("manifest.json", "background.js", "compose-script.js", "mail.js",
                          "panel.html", "panel.css", "panel.js")]
files += [("../src/" + f, f) for f in ("prompts.js", "claude.js", "taskpane.css")]
files += [("../assets/icon-%s.png" % s, "icons/icon-%s.png" % s) for s in (16, 32, 64, 128)]
with zipfile.ZipFile("dist/claude-thunderbird.xpi", "w", zipfile.ZIP_DEFLATED) as z:
    for src, name in files:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, open(src, "rb").read())
PY
echo "Packaged thunderbird/dist/claude-thunderbird.xpi"
