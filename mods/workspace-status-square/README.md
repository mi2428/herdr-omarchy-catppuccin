# Status bar usage

Edit the `status` block's `content.props.usageProviders` in `layouts/omarchy-catppuccin.json` to select which CodexBar values appear. The default is `["codex"]`; valid values are `"codex"`, `"claude"`, `"go"`, and `"zen"` (OpenCode Zen prepaid balance). For example, `["codex", "claude"]` displays those two; `[]` hides all usage meters and skips the CodexBar call. Unknown or duplicate values are errors. The display order is always Codex, Claude, Go, Zen.

CodexBar's `dashboard` command has no provider-selection flag: this option filters the status bar, not the providers CodexBar fetches. Configure enabled providers in CodexBar itself if you also want to avoid those requests.
