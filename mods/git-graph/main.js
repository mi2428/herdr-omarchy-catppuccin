import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, theme } from "herdr";
import { parseHistory, graphRows } from "./history.js";

const ROW = 28, STEP = 14, COLORS = ["ansi4", "ansi5", "ansi2", "ansi3", "ansi6", "ansi1"];
const pad = n => String(n).padStart(2, "0");
const date = seconds => {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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
        const result = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "log", "--all", "HEAD", "--date-order", "--decorate=full", `--max-count=${this.limit + 1}`, "--format=%x1e%H%x1f%P%x1f%ct%x1f%D%x1f%s"], { cwd: top.stdout.trim(), on });
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Cannot read Git history");
        if (context !== JSON.stringify(location())) return;
        const commits = parseHistory(result.stdout);
        this.more = commits.length > this.limit;
        ({ rows: this.rows, columns: this.columns } = graphRows(commits.slice(0, this.limit)));
        this.error = null;
      } catch (e) { if (context === JSON.stringify(location())) { this.rows = []; this.error = String(e); } }
      finally { this.loading = false; cx.notify(); }
    });
  }

  lines(row, t) {
    const x = col => 9 + col * STEP, y = fraction => fraction * ROW;
    return div().relative().w(Math.min(this.columns * STEP + 10, 150)).h(ROW).flex_none().overflow_hidden()
      .children(row.links.map(([from, top, to, bottom, color]) => {
        let path = PathBuilder.stroke(1.6).move_to(x(from), y(top));
        path = from === to ? path.line_to(x(to), y(bottom))
          : path.cubic_bezier_to(x(to), y(bottom), x(from), y(top) + 9, x(to), y(bottom) - 9);
        return window.paint_path(path.build(), t[COLORS[color % COLORS.length]]).absolute().inset_0().size_full();
      }))
      .child(div().absolute().left(x(row.col) - 4).top(ROW / 2 - 4).size(8).rounded_full()
        .bg(t[COLORS[row.col % COLORS.length]]));
  }

  row(row, t) {
    const labels = row.refs.slice(0, 2);
    return h_flex().h(ROW).flex_none().px(7).gap(4).items_center()
      .when(row.refs.some(ref => ref.kind === "head"), el => el.bg(t.selected))
      .child(this.lines(row, t))
      .child(v_flex().flex_1().min_w(0).gap(0)
        .child(div().truncate().text_color(t.foreground).child(row.title || "(no message)"))
        .when(Boolean(row.refs.length), el => el.child(h_flex().gap(3).min_w(0)
          .children(labels.map(ref => div().max_w(96).truncate().px(4).text_size(10)
            .bg(ref.kind === "tag" ? t.ansi3 + "30" : ref.kind === "remote" ? t.ansi6 + "30" : t.ansi4 + "30")
            .text_color(ref.kind === "tag" ? t.ansi3 : ref.kind === "remote" ? t.ansi6 : t.ansi4)
            .child(ref.name)))
          .when(row.refs.length > 2, el => el.child(div().text_size(10).text_color(t.dim).child(`+${row.refs.length - 2}`))))))
      .child(div().w(94).flex_none().text_right().text_size(10).text_color(t.dim).child(date(row.seconds)));
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.context) this.refresh(cx);
    const t = theme();
    return v_flex().id("git-graph").size_full().min_h(0).overflow_hidden().bg(t.background).text_size(12)
      .child(h_flex().h(42).flex_none().px(14).items_center()
        .child(div().font_semibold().text_color(t.foreground).child("Git Graph"))
        .child(div().flex_1())
        .child(div().id("graph-refresh").cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.refresh(cx)).child("↻")))
      .child(v_flex().flex_1().min_h(0)
        .when(Boolean(this.error) || (!this.rows.length && !this.loading), el => el.child(div().p(10).text_color(t.dim).child(this.error || "No commits")))
        .when(!this.rows.length && this.loading, el => el.child(div().p(10).text_color(t.dim).child("Loading history…")))
        .when(Boolean(this.rows.length), el => el.child(v_virtual_list("git-graph-commits", this.rows.length + Number(Boolean(this.more)), ROW,
          i => this.rows[i]?.hash ?? "more", (range, cx) => Array.from({ length: range.end - range.start }, (_, offset) => {
            const i = range.start + offset;
            return this.rows[i] ? this.row(this.rows[i], t) : div().id("graph-more").p(10).text_color(t.ansi4).cursor_pointer()
              .on_click((_e, cx) => { this.limit += 200; this.refresh(cx); }).child("Load more commits…");
          })).flex_1().min_h(0))));
  }
}
