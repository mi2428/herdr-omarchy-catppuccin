import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

/** @typedef {Pick<import("herdr").Program, "key" | "icon" | "name" | "tint"> & {run: string[], installed: boolean}} AgentChoice */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is unknown[]} */
function isArray(value) {
  return Array.isArray(value);
}

/** @param {unknown} value @returns {value is string[]} */
function isStringList(value) {
  return isArray(value) && value.every(item => typeof item === "string");
}

/** @param {unknown} value @returns {value is AgentChoice} */
function isAgent(value) {
  return isRecord(value) && typeof value.key === "string" && typeof value.name === "string"
    && (typeof value.icon === "string" || value.icon === null) && typeof value.tint === "boolean"
    && isStringList(value.run) && typeof value.installed === "boolean";
}

/** @param {unknown} value @returns {value is AgentChoice[]} */
function isAgentList(value) {
  return isArray(value) && value.every(isAgent);
}

/** @param {unknown} value @returns {Record<string, AgentChoice[]>} */
function agentCache(value) {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Invalid cached agent map");
  /** @type {Record<string, AgentChoice[]>} */ const cache = Object.create(null);
  for (const [machine, agents] of Object.entries(value)) {
    if (!isAgentList(agents)) throw new Error(`Invalid cached agents for ${machine}`);
    cache[machine] = agents;
  }
  return cache;
}

/** @param {unknown} value @returns {value is `#${string}`} */
function isColor(value) {
  return typeof value === "string" && value.startsWith("#");
}

// GPUI style methods require colors; herdr.theme() exposes its palette as strings.
/** @param {Record<string, string>} colors @param {string} name @returns {`#${string}`} */
function themeColor(colors, name) {
  const value = colors[name];
  if (!isColor(value)) throw new Error(`Invalid theme color: ${name}`);
  return value;
}

/** The popup contract supplies props().overlay; don't pass an absent id to the host. */
function overlayId() {
  const id = props()?.overlay;
  if (typeof id !== "string") throw new Error("New menu is missing its overlay id");
  return id;
}

/** @param {string} name */
function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  /** @type {Record<"ctrl" | "alt" | "shift" | "cmd" | "fn", string>} */
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  /** @type {(keyof typeof names)[]} */ const order = ["ctrl", "alt", "shift", "cmd", "fn"];
  const alias = new Map([["secondary", mac ? "cmd" : "ctrl"], ["super", "cmd"], ["win", "cmd"]]);
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    // A trailing '-' is encoded as an empty final key segment.
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias.get(m.toLowerCase()) ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...order.filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  /** @param {unknown} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = agentCache(shared(KNOWN))[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...agentCache(shared(KNOWN)), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  /** @param {string} id @param {import("gpui-kit").Element} icon @param {string} name @param {() => void} action @param {string} [hint] @param {boolean} [enabled] */
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).items_center().flex_none()
      .text_color(themeColor(t, enabled ? "foreground" : "dim")).when(enabled, el => el.hover(s => s.bg(themeColor(t, "selected"))))
      .on_click(() => { if (enabled) { closeOverlay(overlayId()); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(themeColor(t, "dim")).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31)).bg(themeColor(t, "popover")).border_1().border_color(themeColor(t, "border")).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(overlayId());
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(themeColor(t, "dim")).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => {
          const icon = a.icon === null ? div().w(14)
            : a.tint ? svg(a.icon).size(14).text_color(themeColor(t, "foreground")) : image(a.icon).size(14);
          return this.row(a.key, icon, a.name,
            () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed);
        }))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(themeColor(t, "dim")).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(themeColor(t, "border")))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
