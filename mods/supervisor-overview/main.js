// Read-only worktree view of agents and explicitly marked supervisor workers.
import { View, div } from "gpui-kit";
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
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(12)
      .child(h_flex().h(31).px(12).flex_none().items_center()
        .child(div().font_medium().text_color(t.dim).child(narrow ? "W" : `Worktrees  ${rows.length}`)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().mode("scrolling")
        .when(!rows.length && !narrow, (el) => el.child(div().px(12).text_color(t.dim).child("No agents")))
        .children(rows.map(({ terminal, agent, status, review: reviewState }) => {
          const cwd = terminal.cwd || "";
          const name = agent?.tab_name && !/^\d+$/.test(agent.tab_name) ? agent.tab_name : agent?.title || terminal.name || terminal.address;
          return v_flex().id(`supervisor-${terminal.address}`).px(narrow ? 8 : 12).py(5).gap(2)
            .cursor_pointer().hover((el) => el.bg(t.hover))
            .tooltip(`${cwd || "Unknown folder"} · ${terminal.address}`)
            .on_click(() => agent?.pane ? run("pane.focus", { pane: agent.pane }) : run("terminal.peek", { terminal: terminal.address }))
            .child(h_flex().gap(6).items_center()
              .child(div().flex_none().text_color(t[status] ?? t.dim).child("●"))
              .when(!narrow, (el) => el.child(div().truncate().text_color(t.foreground).child(folder(cwd)))
                .when(terminal.labels?.["herdr.supervised"] === "1", (el) => el.child(div().flex_none().text_color(t.dim).child("S")))))
            .when(!narrow, (el) => el.child(h_flex().gap(5).pl(13)
              .child(div().min_w(0).flex_1().truncate().text_color(t.dim).child(name))
              .when(Boolean(reviewState), (item) => item.child(div().flex_none().text_color(reviewState === "Review" ? t.blocked : t.dim).child(reviewState)))));
        })));
  }
}
