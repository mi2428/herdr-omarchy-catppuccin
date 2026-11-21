#!/usr/bin/env bash
set -euo pipefail
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/bin" "$root/repo"
export DELTA_REAL=$(command -v delta)
cat > "$root/bin/delta" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$DELTA_ARGS_LOG"
exec "$DELTA_REAL" "$@"
SH
chmod +x "$root/bin/delta"
cd "$root/repo"
git init -q
git -c user.name=Test -c user.email=test@example.invalid commit -qm initial --allow-empty
printf 'old\n' > tracked.txt
git add tracked.txt
git -c user.name=Test -c user.email=test@example.invalid commit -qm tracked
printf 'new\n' > tracked.txt
printf 'addition\n' > added.txt
script=$(dirname "$(dirname "$(realpath "$0")")")/mods/tabs-files/changes-diff.sh
for width in 100 180; do
  export DELTA_ARGS_LOG="$root/$width.args"
  PATH="$root/bin:$PATH" FZF_PREVIEW_COLUMNS="$width" bash "$script" --preview > "$root/$width.out"
done
python3 - "$root" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
for width in (100, 180):
    output = re.sub(r"\x1b\[[0-9;]*m", "", (root / f"{width}.out").read_text())
    assert "M tracked.txt" in output
    assert re.search(r"A .*added.txt", output)
    args = (root / f"{width}.args").read_text()
    assert f"--width={width}" in args
    assert ("--side-by-side" in args) == (width >= 140)
print("Changes preview: M/A and adaptive width OK")
PY
