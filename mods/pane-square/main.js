// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane-square" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";

/** @param {string} value @returns {value is `#${string}`} */
function isColor(value) {
  return value.startsWith("#");
}

// GPUI style methods require colors; herdr.theme() exposes its palette as strings.
/** @param {Record<string, string>} colors @param {string} name @returns {`#${string}`} */
function themeColor(colors, name) {
  const value = colors[name];
  if (!isColor(value)) throw new Error(`Invalid theme color: ${name}`);
  return value;
}

/** @param {import("herdr").Program | null | undefined} p @param {number} size @param {import("gpui-kit").Color} color */
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

/** @param {string | null | undefined} cwd */
function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

  /** @returns {import("herdr").PaneInfo | undefined} */
  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  /** @param {Record<string, string>} t @param {string} id @param {string} icon @param {string} command @param {Record<string, unknown>} args */
  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .text_color(themeColor(t, "dim"))
      .hover((s) => s.bg(themeColor(t, "hover")).text_color(themeColor(t, "foreground")))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, themeColor(t, "dim"));
    const st = p.status;
    const pane = p.pane;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(themeColor(t, "background"))
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(themeColor(t, "foreground")).child(name))
      .child(div().flex_1().truncate().text_color(themeColor(t, "dim")).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(themeColor(t, "working")).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().bg(`${themeColor(t, "blocked")}26`).text_size(10.5).font_semibold().text_color(themeColor(t, "blocked")).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().bg(themeColor(t, "done"))))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
