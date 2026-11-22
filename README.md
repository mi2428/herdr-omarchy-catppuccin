# Herdr Omarchy Catppuccin

A Catppuccin Mocha layout for Herdr app designed to fit Omarchy's Hyprland desktop, with square panes, transparent gaps, and bundled mods.

## Getting Started

Install Herdr app, then run the following from this repository's root:

```sh
install -Dm644 layouts/omarchy-catppuccin.json ~/.config/herdr-app/layouts/omarchy-catppuccin.json
install -Dm644 themes/catppuccin-mocha.json ~/.config/herdr-app/themes/catppuccin-mocha.json
for mod in mods/*; do
  dest="$HOME/.config/herdr-app/$mod"
  install -d "$dest"
  for file in "$mod"/*.js "$mod"/*.sh "$mod"/*.svg "$mod"/mod.json; do
    [ -f "$file" ] && install -m644 "$file" "$dest/"
  done
done
herdr-app do layout.switch '{"name":"omarchy-catppuccin"}'
```

The Changes viewer requires Git and `fzf` on the machine running it.

## Configuration

Edit `layouts/omarchy-catppuccin.json` and reinstall it to change this layout.
Choose a Nerd Font for both terminal and interface text in Herdr app settings; the layout does not override those fonts.

| Setting | Location | Values |
| --- | --- | --- |
| File viewer | `content.props.fileViewer` in the `files` block | `"nvim"` (default), `"bat"`, or `"less"`; install it on the space's machine. |
| Usage meters | `content.props.usageProviders` in the `status` block | An array of `"codex"`, `"claude"`, `"go"`, and `"zen"` (default `["codex"]`); `[]` hides meters; showing values requires `codexbar`. |
| Pane spacing | `gap` on a row or column; `main.content.pane.gap` for terminal splits | Pixels between direct children. |

## License

[MIT](LICENSE).
