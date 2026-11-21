#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != --preview ]]; then
  printf 'Working tree\n' | fzf --disabled --no-info --no-sort \
    --header='Changes  (q to close)' \
    --preview-window=up,90%,border-none,nowrap \
    --preview='bash "$HOME/.config/herdr-app/mods/tabs-files/changes-diff.sh" --preview' \
    --bind='q:abort,resize:refresh-preview' >/dev/null || [[ $? -eq 1 ]]
  exit
fi

width=${FZF_PREVIEW_COLUMNS:?}
[[ $width =~ ^[1-9][0-9]*$ ]] || exit 2
git rev-parse --is-inside-work-tree >/dev/null
layout=()
if ((width < 140)); then layout=(--unified); fi
git-delta-input --range HEAD --include-staged -- |
  python3 "$HOME/.config/fish/lib/dotfiles_git_delta_sections.py" "${layout[@]}" \
    delta --paging=never --features=catppuccin-mocha --dark --true-color=always \
    --line-numbers --width="$width" \
    --file-added-label=A --file-modified-label=M --file-removed-label=D --file-renamed-label=R
