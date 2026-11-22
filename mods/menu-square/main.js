// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec } from "herdr";

/** @typedef {import("herdr").SpaceInfo} SpaceInfo */
/** @typedef {{parent?:string|null, address:string, name?:string, labels?:Record<string,string>}} MenuTerminal */
/** @typedef {"main"|"linked"|null} Checkout */
/** @typedef {[label:string, command:string, args:Record<string, unknown>]} MenuItem */
/** @typedef {Record<string,string|null>} MenuTarget */
/** @typedef {{tab:"pane"|"tab"|"space"|"global", target:MenuTarget, square:boolean, overlay?:string}} MenuProps */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is MenuProps["tab"]} */
function isMenuTab(value) { return value === "pane" || value === "tab" || value === "space" || value === "global"; }

/** @param {unknown} value @returns {value is Record<string, string>} */
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
/** @param {unknown} value @returns {value is MenuTarget} */
function isMenuTarget(value) {
  return isRecord(value) && Object.entries(value).every(([key, entry]) =>
    typeof entry === "string" || (key === "terminal" && entry === null));
}

/** @param {unknown} value @returns {MenuProps} */
function menuProps(value) {
  if (value == null) return { tab: "global", target: {}, square: false };
  if (!isRecord(value)) throw new Error("Invalid menu props");
  const tab = value.tab;
  if (tab !== undefined && !isMenuTab(tab)) throw new Error("Invalid menu tab");
  const target = value.target ?? {};
  if (!isMenuTarget(target)) throw new Error("Invalid menu target");
  if (value.square !== undefined && typeof value.square !== "boolean") throw new Error("Invalid menu frame flag");
  if (value.overlay !== undefined && typeof value.overlay !== "string") throw new Error("Invalid menu overlay");
  return {
    tab: isMenuTab(tab) ? tab : "global",
    target,
    square: value.square === true,
    ...(typeof value.overlay === "string" ? { overlay: value.overlay } : {}),
  };
}

/** @param {unknown} value @returns {MenuTerminal} */
function menuTerminal(value) {
  if (!isRecord(value) || typeof value.address !== "string") throw new Error("Invalid terminal menu target");
  if (value.parent != null && typeof value.parent !== "string") throw new Error("Invalid terminal parent");
  if (value.name != null && typeof value.name !== "string") throw new Error("Invalid terminal name");
  if (value.labels != null && !isStringRecord(value.labels)) throw new Error("Invalid terminal labels");
  return {
    address: value.address,
    ...(typeof value.parent === "string" ? { parent: value.parent } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(isStringRecord(value.labels) ? { labels: value.labels } : {}),
  };
}

/** @param {string} label @param {string} command @param {Record<string, unknown>} args @returns {MenuItem} */
function item(label, command, args) { return [label, command, args]; }

/** @param {string} value @returns {value is import("gpui-kit").Color} */
function isColor(value) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value); }

/** @param {Record<string,string>} colors @param {string} name @returns {import("gpui-kit").Color} */
function themeColor(colors, name) {
  const value = colors[name];
  if (!isColor(value)) throw new Error(`Invalid theme color: ${name}`);
  return value;
}

// Where a space is now: its first terminal's live folder, else where it was made.
/** @param {SpaceInfo} s */
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
/** @param {string} folder @param {string|null} on @returns {Promise<Checkout>} */
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}
/** @param {unknown} _error @returns {null} */
function noCheckout(_error) { return null; }

/** @param {unknown} value @param {Checkout} git @returns {MenuItem[]} */
function items(value, git) {
  const p = menuProps(value);
  const tg = p.target;
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals().map(menuTerminal);
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
        ...(inTab
          ? [
              item("Split right", "pane.split", { direction: "right", pane: tg.pane }),
              item("Split down", "pane.split", { direction: "down", pane: tg.pane }),
              item("Zoom", "pane.zoom", { pane: tg.pane }),
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? item("Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" })
                : item("Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }),
            ]
          : []),
        ...(parent ? [item(`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address })] : []),
        ...(inTab ? [item("Close pane", "pane.close", { pane: tg.pane })] : []),
      ];
    }
    case "tab":
      return [
        item("Rename", "tab.rename", { id: tg.id }),
        item("New tab", "tab.new", { space: tg.space }),
        item("Close", "tab.close", { id: tg.id }),
      ];
    case "space":
      return [
        item("Rename", "space.rename", { id: tg.id }),
        ...(git ? [item("New worktree", "worktree", { space: tg.id, action: "new" }), item("Open worktree", "worktree", { space: tg.id, action: "open" })] : []),
        ...(git === "linked" ? [item("Remove worktree", "worktree", { space: tg.id, action: "remove" })] : []),
        item("Close", "space.close", { id: tg.id }),
      ];
    default:
      return [
        item("New space", "space.new", {}),
        item("Keybinds", "app.help", {}),
        item("Theme: graphite", "app.theme", { name: "graphite" }),
        item("Theme: ink", "app.theme", { name: "ink" }),
        item("Theme: moss", "app.theme", { name: "moss" }),
        item("Theme: atom one dark", "app.theme", { name: "atom-one-dark" }),
      ];
  }
}

/** @param {string} command */
function menuIcon(command) {
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
/** @param {string} name @param {Record<string, unknown>} args */
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  /** @param {Record<string, unknown>} _props @param {import("gpui-kit").Context} cx */
  init(_props, cx) {
    this.at = 0;
    /** @type {Checkout} */
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = menuProps(props());
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(noCheckout);
        cx.notify();
      });
  }

  /** @param {number} i @param {import("gpui-kit").Context} cx */
  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    const overlay = menuProps(props()).overlay;
    if (!overlay) throw new Error("Menu is missing its overlay id");
    closeOverlay(overlay);
    if (it[1] === "worktree") {
      const action = it[2].action;
      if (action !== "new" && action !== "open" && action !== "remove") throw new Error("Invalid worktree action");
      openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    }
    else run(it[1], it[2]);
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(themeColor(t, "popover"))
      .when(menuProps(props()).square, el => el.border_1().border_color(themeColor(t, "border")))
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") {
          const overlay = menuProps(props()).overlay;
          if (!overlay) throw new Error("Menu is missing its overlay id");
          closeOverlay(overlay);
        }
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(themeColor(t, "border"))))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)

            .items_center()
            .justify_between()
            .text_color(themeColor(t, "foreground"))
            .when(i === this.at, (el) => el.bg(themeColor(t, "selected")))
            .hover((s) => s.bg(themeColor(t, "hover")))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(themeColor(t, "muted")))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(themeColor(t, "dim")).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
