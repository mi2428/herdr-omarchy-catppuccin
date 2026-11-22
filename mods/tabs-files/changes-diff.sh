#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != --preview ]]; then
  printf '\n' | fzf --ansi --disabled --no-input --no-info --no-sort --no-separator --pointer=' ' \
    --preview-window=up,99%,border-none,nowrap \
    --preview='bash "$HOME/.config/herdr-app/mods/tabs-files/changes-diff.sh" --preview' \
    --bind='q:abort,resize:refresh-preview' >/dev/null || [[ $? -eq 1 ]]
  exit
fi

git rev-parse --is-inside-work-tree >/dev/null
git status --short --untracked-files=all
git -c color.ui=always diff --no-ext-diff HEAD --
git ls-files --others --exclude-standard -z |
  while IFS= read -r -d '' file; do
    git -c color.ui=always diff --no-index -- /dev/null "$file" || [[ $? -eq 1 ]]
  done
