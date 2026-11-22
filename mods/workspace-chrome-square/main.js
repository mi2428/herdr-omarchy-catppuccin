import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

/** @typedef {{id?: string, children?: unknown[], size?: {px?: number} | null}} LayoutNode */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// layout() is declared unknown; validate the fields this traversal reads.
/** @param {unknown} value @returns {value is LayoutNode} */
function isLayoutNode(value) {
  if (!isRecord(value)) return false;
  return (value.id === undefined || typeof value.id === "string")
    && (value.children === undefined || Array.isArray(value.children))
    && (value.size === undefined || value.size === null || (isRecord(value.size)
      && (value.size.px === undefined || typeof value.size.px === "number")));
}

/** @param {unknown} node @param {string} id @returns {LayoutNode | null} */
function find(node, id) {
  if (!isLayoutNode(node)) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar rail follows its actual width, including manual resizing.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

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

export default class WorkspaceChrome extends View {
  /** @param {string} id @param {import("gpui-kit").Element} label @param {() => void} action */
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().text_color(themeColor(t, "muted")).hover(s => s.bg(themeColor(t, "hover")).text_color(themeColor(t, "foreground")))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      /** @param {string} id @param {string} icon @param {string} label @param {boolean} dim @param {() => void} action @returns {import("gpui-kit").Element} */
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(26).flex_none().px(5).gap(5).items_center()
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(themeColor(t, dim ? "dim" : "muted")).hover(s => s.bg(themeColor(t, "hover")).text_color(themeColor(t, "foreground"))).cursor_pointer()
        .on_click(action).child(svg(`mods/workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).bg(themeColor(t, "accent"));
      return h_flex().size_full().bg(themeColor(t, "chrome")).px(4).gap(2).items_center().text_size(12)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().bg(themeColor(t, "chrome")).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20)).child(div().font_semibold().text_color(themeColor(t, "foreground")).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/workspace-chrome/search.svg").size(15), () => run("mod.open", { name: "picker-square" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/workspace-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
