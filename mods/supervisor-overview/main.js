// Read-only worktree view of agents and explicitly marked supervisor workers.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, run, theme, layout } from "herdr";

const priority = { blocked: 0, done: 1, working: 2, idle: 3 };
const review = { pending: "Review", reviewing: "Review", accepted: "Accepted" };
const folder = (path) => (path || "unknown").replace(/\/$/, "").split("/").pop() || "unknown";

export function entries(all, listed) {
  const byAddress = new Map(listed.map((a) => [a.address, a]));
  return all.filter((t) => t.state === "live" && (byAddress.has(t.address) || t.labels?.["herdr.supervised"] === "1"))
    .map((t) => ({ terminal: t, agent: byAddress.get(t.address), status: byAddress.get(t.address)?.status ?? "unknown",
      review: t.labels?.["herdr.supervised"] === "1" ? review[t.labels?.["herdr.review"]] ?? null : null }))
    .sort((a, b) => (a.review === "Review" ? -1 : 0) - (b.review === "Review" ? -1 : 0)
      || (priority[a.status] ?? 4) - (priority[b.status] ?? 4)
      || a.terminal.address.localeCompare(b.terminal.address));
}

export default class SupervisorOverview extends View {
  render() {
    const t = theme();
    const narrow = (layout()?.children?.[0]?.size?.px ?? 250) < 160;
    const rows = entries(terminals(), agents());
    const state = (status) => {
      if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
      if (status === "blocked") return div().px(6).h(18).flex_none().bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
      if (status === "idle") return div().size(7).mx(3).flex_none().border(1.5).border_color(t.idle ?? t.dim);
      return div().size(7).mx(3).flex_none().bg(t[status] ?? t.dim);
    };
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).flex_none().items_center().justify_between().text_size(11.5).text_color(t.dim)
        .child("Worktrees")
        .when(!narrow, (el) => el.child(div().text_size(11).child(String(rows.length)))))
      .child(v_flex().flex_1().min_h(0).px(narrow ? 0 : 8).overflow_y_scrollbar().mode("scrolling")
        .when(!rows.length && !narrow, (el) => el.child(div().px(12).text_size(12).text_color(t.dim).child("No agents yet")))
        .children(rows.map(({ terminal, agent, status, review: reviewState }) => {
          const cwd = terminal.cwd || "";
          const name = agent?.tab_name && !/^\d+$/.test(agent.tab_name) ? agent.tab_name : agent?.title || terminal.name || terminal.address;
          const program = agent?.program;
          const icon = program?.icon ? program.tint ? svg(program.icon).size(16).flex_none().text_color(t.foreground) : image(program.icon).w(16).h(16).flex_none() : null;
          return h_flex().id(`supervisor-${terminal.address}`).h(narrow ? 26 : 42).px(8).gap(9).flex_none().items_center()
            .when(agent?.focused, (el) => el.bg(t.selected))
            .cursor_pointer().hover((el) => el.bg(t.hover))
            .tooltip(`${cwd || "Unknown folder"} · ${terminal.address}`)
            .on_click(() => agent?.pane ? run("pane.focus", { pane: agent.pane }) : run("terminal.peek", { terminal: terminal.address }))
            .when(Boolean(icon), (el) => el.child(icon))
            .when(!narrow, (el) => el.child(v_flex().flex_1().min_w(0).gap(2)
              .child(div().truncate().text_color(agent?.status === "idle" && !agent.focused ? t.muted : t.foreground).child(folder(cwd)))
              .child(h_flex().min_w(0).gap(5).text_size(11).text_color(t.dim)
                .child(div().min_w(0).flex_1().truncate().child(name))
                .when(terminal.labels?.["herdr.supervised"] === "1", (el) => el.child(div().flex_none().text_color(t.accent).child("S")))
                .when(Boolean(reviewState), (el) => el.child(div().flex_none().text_color(reviewState === "Review" ? t.blocked : t.dim).child(reviewState))))))
            .child(state(status));
        })));
  }
}
