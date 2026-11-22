import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, theme } from "herdr";
import { parseHistory, graphRows, worktreeRows, countChanges, relativeTime } from "./history.js";

const ROW = 22, STEP = 14, COLORS = ["ansi4", "ansi5", "ansi2", "ansi3", "ansi6", "ansi1"];
const rowHeight = row => row.worktree ? 26 : row.refs.length ? 36 : ROW;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export default class GitGraph extends View {
  init(_props, cx) {
    this.rows = []; this.columns = 1; this.limit = 200;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = JSON.stringify({ cwd, on });
    this.context = context;
    if (!cwd) { this.rows = []; this.error = "No folder selected"; return; }
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (top.code !== 0) throw new Error("Not a Git repository");
        const root = top.stdout.trim();
        const head = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, on });
        if (head.code !== 0) {
          const unborn = await exec("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: root, on });
          if (unborn.code !== 0) throw new Error(head.stderr.trim() || "Cannot read HEAD");
        }
        const result = head.code === 0
          ? await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "log", "--all", "HEAD", "--date-order", "--decorate=full", `--max-count=${this.limit + 1}`, "--format=%x1e%H%x1f%P%x1f%ct%x1f%D%x1f%s"], { cwd: root, on })
          : { code: 0, stdout: "" };
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Cannot read Git history");
        const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--renames", "--untracked-files=all"], { cwd: root, on });
        if (status.code !== 0) throw new Error(status.stderr.trim() || "Cannot read Git status");
        if (context !== JSON.stringify(location())) return;
        const commits = parseHistory(result.stdout);
        this.more = commits.length > this.limit;
        const count = countChanges(status.stdout);
        const graph = graphRows(commits.slice(0, this.limit));
        this.rows = worktreeRows(graph.rows, count);
        this.columns = graph.columns + Number(count > 0);
        this.error = null;
      } catch (e) { if (context === JSON.stringify(location())) { this.rows = []; this.error = String(e); } }
      finally { this.loading = false; cx.notify(); }
    });
  }

  lines(row, t) {
    const height = rowHeight(row), dot = row.refs.length ? ROW / 2 + 1 : height / 2;
    const x = col => 9 + (this.rows[0]?.worktree ? STEP : 0) + col * STEP;
    const y = fraction => fraction === 0.5 ? dot : fraction * height;
    return div().relative().w(Math.min(this.columns * STEP + 10, 150)).h(height).flex_none().overflow_hidden()
      .when(row.worktreeLink, el => {
        const line = PathBuilder.stroke(1.6).dash_array([2, 3]).move_to(9, row.worktree ? dot : 0);
        const path = row.worktreeTarget ? line.cubic_bezier_to(x(row.col), dot, 9, dot, x(row.col), dot) : line.line_to(9, height);
        return el.child(window.paint_path(path.build(), t.muted).absolute().inset_0().size_full());
      })
      .children(row.links.map(([from, top, to, bottom, color]) => {
        let path = PathBuilder.stroke(1.6).move_to(x(from), y(top));
        path = from === to ? path.line_to(x(to), y(bottom))
          : path.cubic_bezier_to(x(to), y(bottom), x(from), y(top) + 9, x(to), y(bottom) - 9);
        return window.paint_path(path.build(), t[COLORS[color % COLORS.length]]).absolute().inset_0().size_full();
      }))
      .child(div().absolute().left((row.worktree ? 9 : x(row.col)) - 4).top(dot - 4).size(8).rounded_full()
        .when(row.worktree, el => el.bg(t.chrome).border(2).border_color(t.muted))
        .when(!row.worktree, el => el.bg(t[COLORS[row.col % COLORS.length]])));
  }

  row(row, t) {
    const labels = row.refs.slice(0, 2);
    return h_flex().h(rowHeight(row)).w_full().min_w(0).flex_none().px(7).gap(4).items_center()
      .child(this.lines(row, t))
      .child(v_flex().flex_1().min_w(0).overflow_hidden().gap(0)
        .child(div().truncate().tooltip(row.title).text_color(row.worktree ? t.working : t.foreground).child(row.title || "(no message)"))
        .when(Boolean(row.refs.length), el => el.child(h_flex().gap(3).min_w(0)
          .children(labels.map(ref => {
            const color = ref.kind === "tag" ? t.ansi3 : ref.kind === "remote" ? t.ansi6 : ref.kind === "head" ? t.ansi4 : t.ansi5;
            return h_flex().h(18).max_w(104).min_w(0).px(4).gap(3).items_center().rounded(4).border(1).border_color(color)
              .bg(ref.kind === "head" ? color : t.chrome).text_color(ref.kind === "head" ? t.accent_foreground : color)
              .child(ref.kind === "head" ? "✓" : ref.kind === "tag" ? "◆" : svg("mods/git-graph/branch.svg").size(10).flex_none())
              .child(div().min_w(0).truncate().text_size(10).child(ref.name));
          }))
          .when(row.refs.length > 2, el => el.child(div().text_size(10).text_color(t.dim).child(`+${row.refs.length - 2}`))))))
      .child(div().w(30).flex_none().text_right().text_size(10).text_color(t.dim).child(row.worktree ? "*" : relativeTime(row.seconds)));
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.context) this.refresh(cx);
    const t = theme();
    return v_flex().id("git-graph").size_full().min_h(0).overflow_hidden().bg(t.background).text_size(12)
      .child(h_flex().h(31).flex_none().pl(16).pr(10).items_center().text_size(11.5).text_color(t.dim)
        .child(div().child("Git Graph"))
        .child(div().flex_1())
        .child(div().id("graph-refresh").size(26).flex_none().flex().items_center().justify_center()
          .cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx)).child(svg("mods/git-graph/refresh.svg").size(14))))
      .child(v_flex().relative().flex_1().min_h(0)
        .when(Boolean(this.error) || (!this.rows.length && !this.loading), el => el.child(div().p(10).text_color(t.dim).child(this.error || "No commits")))
        .when(!this.rows.length && this.loading, el => el.child(div().p(10).text_color(t.dim).child("Loading history…")))
        .when(Boolean(this.rows.length), el => el.child(v_virtual_list("git-graph-commits", this.rows.length + Number(Boolean(this.more)),
          this.rows.map(rowHeight).concat(this.more ? [32] : []),
          i => this.rows[i]?.hash ?? "more", (range, cx) => Array.from({ length: range.end - range.start }, (_, offset) => {
            const i = range.start + offset;
            return this.rows[i] ? this.row(this.rows[i], t) : div().id("graph-more").p(10).text_color(t.ansi4).cursor_pointer()
              .on_click((_e, cx) => { this.limit += 200; this.refresh(cx); }).child("Load more commits…");
          })).flex_1().min_h(0)))
        .when(Boolean(this.rows.length), el => el.child(Scrollbar.vertical("git-graph-commits").mode("scrolling").absolute().inset_0())));
  }
}
