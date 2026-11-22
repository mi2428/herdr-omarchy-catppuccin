#!/usr/bin/env bash
set -euo pipefail
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
cd "$root"
git init -q
git -c user.name=Test -c user.email=test@example.invalid commit -qm initial --allow-empty
printf 'old\n' > tracked.txt
git add tracked.txt
git -c user.name=Test -c user.email=test@example.invalid commit -qm tracked
printf 'new\n' > tracked.txt
printf 'staged\n' > staged.txt
git add staged.txt
printf 'addition\n' > 'new file.txt'
script=$(dirname "$(dirname "$(realpath "$0")")")/mods/tabs-files/changes-diff.sh
bash "$script" --preview > "$root/preview"
python3 - "$root/preview" <<'PY'
from pathlib import Path
import re
import sys

output = re.sub(r"\x1b\[[0-9;]*m", "", Path(sys.argv[1]).read_text())
for text in (" M tracked.txt", "A  staged.txt", "?? \"new file.txt\"", "+new", "+staged", "+addition"):
    assert text in output, text
print("Changes preview: tracked, staged, and untracked files OK")
PY
if (cd "$root/.." && bash "$script" --preview >/dev/null 2>&1); then
  echo 'Changes preview unexpectedly succeeded outside Git' >&2
  exit 1
fi
