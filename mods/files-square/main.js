// A lazy file browser for the focused pane's folder.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, window, openOverlay, closeOverlay, notify, props, run, terminals } from "herdr";

/** @returns {{cwd: string | undefined, on: string | null, space: string | undefined}} */
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
/** @type {Record<string, [string, string]>} */
const FILE_ICONS = Object.assign(Object.create(null), {
  ".env": ["", "ansi3"], ".gitignore": ["", "ansi1"], ".editorconfig": ["", "ansi7"],
  "readme.md": ["󰂺", "ansi4"], "license": ["", "ansi3"], "dockerfile": ["󰡨", "ansi4"],
  "package.json": ["", "ansi1"], "makefile": ["", "ansi2"],
  md: ["", "ansi4"], txt: ["󰈙", "muted"], pdf: ["", "ansi1"],
  js: ["", "ansi3"], mjs: ["", "ansi3"], cjs: ["", "ansi3"], jsx: ["", "ansi3"],
  ts: ["", "ansi4"], mts: ["", "ansi4"], cts: ["", "ansi4"], tsx: ["", "ansi4"],
  json: ["", "ansi3"], jsonc: ["", "ansi3"], yaml: ["", "ansi5"], yml: ["", "ansi5"], toml: ["", "ansi6"],
  html: ["", "ansi1"], css: ["", "ansi4"], scss: ["", "ansi5"], vue: ["󰡄", "ansi2"], svelte: ["", "ansi1"],
  py: ["", "ansi3"], lua: ["", "ansi4"], nix: ["", "ansi4"], sh: ["", "ansi2"], bash: ["", "ansi2"], fish: ["", "ansi2"],
  rs: ["", "ansi1"], go: ["", "ansi6"], c: ["", "ansi4"], h: ["", "ansi5"], cpp: ["", "ansi5"], sql: ["", "ansi6"],
  svg: ["󰜡", "ansi3"], png: ["", "ansi5"], jpg: ["", "ansi5"], jpeg: ["", "ansi5"], webp: ["", "ansi5"], gif: ["", "ansi5"],
  zip: ["", "ansi3"], gz: ["", "ansi3"], tar: ["", "ansi3"], lock: ["", "muted"],
});
/** @param {string} name @returns {[string, string]} */
const fileIcon = (name) => {
  const lower = name.toLowerCase();
  return FILE_ICONS[lower] ?? FILE_ICONS[lower.slice(lower.lastIndexOf(".") + 1)] ?? ["󰈙", "muted"];
};
const PER_FOLDER = 500, TOTAL = 5000;
/** @type {Record<string, string[]>} */
const VIEWERS = {
  nvim: ["nvim", "--"],
  bat: ["bat", "--paging=always", "--"],
  less: ["less", "-R", "--"],
};

/** @typedef {"A" | "M" | "D" | "U"} FileMark */
/** @typedef {[number, number]} FileCounts */
/** @typedef {[number, number, boolean]} FolderCounts */
/** @typedef {{files: Record<string, FileCounts>, folders: Record<string, FolderCounts>}} ChangeCounts */
/** @typedef {{name: string, dir: boolean}} FileEntry */
/** @typedef {{key: string, cwd: string | undefined, on: string | null}} FileContext */

/** @param {string} output @param {string} top @param {string} root @param {Record<string, FileMark>} marks @returns {ChangeCounts} */
function changeCounts(output, top, root, marks) {
  /** @type {Record<string, FileCounts>} */ const files = {};
  /** @type {Record<string, FolderCounts>} */ const folders = {};
  for (const line of output.split("\0").filter(Boolean)) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(line);
    if (!match) throw new Error("Invalid git numstat output");
    if (match[1] !== "-" && match[2] !== "-") files[`${top}/${match[3]}`] = [Number(match[1]), Number(match[2])];
  }
  for (const path of Object.keys(marks)) {
    if (!path.startsWith(root + "/")) continue;
    const parts = path.slice(root.length + 1).split("/"), count = files[path];
    for (let i = 1; i < parts.length; i++) {
      const folder = `${root}/${parts.slice(0, i).join("/")}`;
      const total = folders[folder] ??= [0, 0, true];
      if (count) { total[0] += count[0]; total[1] += count[1]; }
      else total[2] = false;
    }
  }
  return { files, folders };
}

/** @param {string} path @param {string | null} on @returns {Promise<FileEntry[]>} */
async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    /** @type {FileEntry[] | FileEntry} */ const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isOptions(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} value @returns {value is `#${string}`} */
function isColor(value) {
  return value.startsWith("#");
}

// theme() exposes a string map; GPUI style methods require its #-prefixed color values.
/** @param {Record<string, string>} colors @param {string} name @returns {`#${string}`} */
function themeColor(colors, name) {
  const value = colors[name];
  if (!isColor(value)) throw new Error(`Invalid theme color: ${name}`);
  return value;
}

export default class Files extends View {
  /** @param {unknown} config @param {import("gpui-kit").AsyncContext} cx */
  init(config, cx) {
    const configOptions = isOptions(config) ? config : {};
    const rawProps = props();
    const propOptions = isOptions(rawProps) ? rawProps : {};
    const terminal = configOptions.terminal ?? propOptions.terminal;
    const requestedViewerValue = configOptions.fileViewer ?? propOptions.fileViewer;
    if (requestedViewerValue != null && (typeof requestedViewerValue !== "string" || !Object.hasOwn(VIEWERS, requestedViewerValue)))
      throw new Error(`Unknown fileViewer: ${String(requestedViewerValue)}`);
    this.viewer = typeof terminal === "string" ? terminal : undefined;
    const requestedViewer = typeof requestedViewerValue === "string" ? requestedViewerValue : undefined;
    if (this.viewer) {
      this.viewerMode = requestedViewer;
      const overlayValue = configOptions.overlay ?? propOptions.overlay;
      const overlay = typeof overlayValue === "string" ? overlayValue : undefined;
      cx.timer.every(1000, () => {
        if (!terminals().some(t => t.address === this.viewer && t.state === "live")) closeOverlay(overlay);
      });
      return;
    }
    const fileViewer = requestedViewer ?? "nvim";
    this.fileViewer = fileViewer;
    if (!Object.hasOwn(VIEWERS, this.fileViewer)) throw new Error(`Unknown fileViewer: ${this.fileViewer}`);
    /** @type {Map<string, {folders: Set<string>}>} */ this.saved = new Map();
    /** @type {Map<string, FileEntry[]>} */ this.entries = new Map();
    this.folders = new Set(); this.pending = new Set();
    /** @type {Record<string, FileMark>} */ this.marks = {};
    /** @type {ChangeCounts} */ this.counts = { files: {}, folders: {} };
    /** @type {FileContext | undefined} */ this.context = undefined;
    /** @type {string | null} */ this.watched = null;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  close() {
    if (this.viewer && terminals().some(t => t.address === this.viewer && t.state === "live")) run(this.viewerMode === "nvim" ? "terminal.keep" : "terminal.kill", { terminal: this.viewer });
  }

  /** @param {string} root @param {import("gpui-kit").AsyncContext} cx */
  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  /** @param {FileContext} context */
  current(context) {
    return this.context === context && key() === context.key;
  }

  /** @param {string} path @param {FileContext} context */
  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    if (!root) return;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.counts = { files: {}, folders: {} }; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    if (!context) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        /** @type {Record<string, FileMark>} */ const marks = {};
        /** @type {ChangeCounts} */ let counts = { files: {}, folders: {} };
        // Git uses a non-zero exit for ordinary non-repository folders; other failures are actionable.
        if (top.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on });
          if (status.code !== 0) throw new Error(status.stderr || "Cannot read Git status");
          for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
          const head = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd, on });
          const diff = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "diff", "--numstat", "-z", "--no-renames", ...(head.code === 0 ? ["HEAD"] : ["--cached"])], { cwd, on });
          if (diff.code !== 0) throw new Error(diff.stderr || "Cannot count Git changes");
          counts = changeCounts(diff.stdout, top.stdout.trim(), cwd, marks);
        } else if (!/not a git repository/i.test(top.stderr)) {
          throw new Error(top.stderr || "Cannot find Git repository");
        }
        if (!this.current(context)) return;
        this.marks = marks; this.counts = counts; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  /** @param {string} path @param {import("gpui-kit").AsyncContext} cx */
  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  /** @param {string} path @param {import("gpui-kit").AsyncContext} cx */
  show(path, cx) {
    if (this.opening) return;
    this.opening = true;
    const root = this.root, on = this.on;
    cx.spawn(async () => {
      try {
        if (!root) throw new Error("No folder selected");
        const args = ["run", "--json", "--bg", "--rm", "--cwd", root];
        if (on) args.push("--on", on);
        args.push("--", ...VIEWERS[this.fileViewer], `${root}/${path}`);
        const result = await exec("hc", args);
        if (result.code !== 0) throw new Error(result.stderr || `Cannot start ${this.fileViewer}`);
        const terminal = JSON.parse(result.stdout).address;
        if (!terminal) throw new Error("No terminal address returned");
        try {
          openOverlay({ kind: "dialog", frame: "none", width: 0.8, height: 0.8, layout: { type: "column", background: "#1e1e2eeb", radius: 0, children: [
            { type: "block", size: { px: 0 }, content: { mod: "files-square", props: { terminal, fileViewer: this.fileViewer } } },
            { type: "block", content: { terminal } },
          ] } });
        } catch (e) {
          await exec("hc", ["kill", terminal]);
          throw e;
        }
      } catch (e) { notify({ title: "Cannot open file", body: String(e), level: "error" }); }
      finally { this.opening = false; }
    });
  }

  /** @param {string} prefix @param {number} depth @param {import("gpui-kit").Element[]} out @param {Record<string, string>} t @returns {import("gpui-kit").Element[]} */
  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), absolute = `${this.root}/${path}`;
      const count = (entry.dir ? this.counts.folders : this.counts.files)[absolute];
      const mark = entry.dir ? (!open && (count || this.marks[absolute]) ? "M" : null) : this.marks[absolute];
      const [glyph, color] = entry.dir ? [open ? "" : "", "ansi4"] : fileIcon(entry.name);
      out.push(h_flex().id(`file-${path}`).h(22).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().cursor_pointer().hover(s => s.bg(themeColor(t, "hover")))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(themeColor(t, "dim")) : div().w(12).flex_none())
        .child(div().w(14).flex_none().font_family("JetBrainsMono Nerd Font").text_size(15).text_color(themeColor(t, color)).child(glyph))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el
          .when(count && count[2] !== false, el => el.child(div().text_size(11).text_color(themeColor(t, "ansi2")).child(`+${count[0]}`))
            .child(div().text_size(11).text_color(themeColor(t, "ansi1")).child(`-${count[1]}`)))
          .child(div().text_size(11).text_color(themeColor(t, mark === "A" ? "ansi2" : mark === "D" || mark === "U" ? "ansi1" : "blocked")).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    if (this.viewer) return div();
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().bg(themeColor(t, "background")).text_color(themeColor(t, "foreground")).text_size(13)
      .child(h_flex().h(31).flex_none().pl(16).pr(10).gap(8).items_center().text_size(11.5).text_color(themeColor(t, "dim"))
        .child(div().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().mode("scrolling").p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(themeColor(t, "dim")).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(themeColor(t, "dim")).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
