import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, terminals, exec, run, openOverlay, closeOverlay, notify, props, theme, window, layout, settings } from "herdr";

/** @typedef {{id?: string, children?: unknown[], hidden?: boolean, size?: {px?: number} | null}} LayoutNode */
/** @typedef {{acc: number, steps: number, at: number, last: number}} Swipe */
/** @typedef {{want: number, until: number}} PendingPanel */
/** @typedef {{address: string, state: string, parent?: string | null, labels?: Record<string, unknown> | null}} TerminalSnapshot */
/** @typedef {Record<string, import("gpui-kit").Color>} Theme */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** @param {unknown} value @returns {value is LayoutNode} */
function isLayoutNode(value) {
  return isRecord(value) && (value.id === undefined || typeof value.id === "string")
    && (value.children === undefined || Array.isArray(value.children))
    && (value.hidden === undefined || typeof value.hidden === "boolean")
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

/** @param {unknown} value @returns {value is TerminalSnapshot} */
function isTerminal(value) {
  return isRecord(value) && typeof value.address === "string" && typeof value.state === "string"
    && (value.parent === undefined || value.parent === null || typeof value.parent === "string")
    && (value.labels === undefined || value.labels === null || isRecord(value.labels));
}

/** @param {string} address @returns {boolean} */
function hasLiveTerminal(address) {
  return terminals().some(value => isTerminal(value) && value.address === address && value.state === "live");
}

/** @param {unknown} value @returns {value is import("gpui-kit").Color} */
function isColor(value) { return typeof value === "string" && value.startsWith("#"); }

/** @param {Record<string, string>} colors @returns {Theme} */
function checkedTheme(colors) {
  /** @type {Theme} */
  const checked = Object.create(null);
  for (const [name, value] of Object.entries(colors)) {
    if (!isColor(value)) throw new Error("Invalid theme color: " + name);
    checked[name] = value;
  }
  return checked;
}

/** @param {import("gpui-kit").Color} color @param {"30" | "45"} alpha @returns {import("gpui-kit").Color} */
function withAlpha(color, alpha) { return `${color}${alpha}`; }

/** @param {unknown} layout @returns {number[] | undefined} */
function trafficLights(layout) {
  if (!isRecord(layout) || layout.traffic_lights === undefined) return undefined;
  const lights = layout.traffic_lights;
  if (!Array.isArray(lights) || !lights.length || !lights.every(light => typeof light === "number"))
    throw new Error("Invalid layout traffic lights");
  return lights;
}

/** @returns {number} */
function zoom() {
  const value = settings().zoom;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("Invalid zoom setting");
  return value;
}

/** @param {LayoutNode | null | undefined} panel @returns {number} */
function panelMask(panel) {
  if (!panel || panel.hidden) return 0;
  return (find(panel, "files")?.hidden ? 0 : 1) | (find(panel, "git")?.hidden ? 0 : 2);
}

/** @param {number} mask */
function showPanel(mask) {
  if (mask) {
    run(mask & 1 ? "layout.show" : "layout.hide", { id: "files" });
    run(mask & 2 ? "layout.show" : "layout.hide", { id: "git" });
  }
  run(mask ? "layout.show" : "layout.hide", { id: "panel" });
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
/** @type {(s: string | null | undefined) => string} */
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
/** @param {import("herdr").TabInfo} tab @param {import("herdr").PaneInfo | undefined} lead @returns {string} */
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

export default class Tabs extends View {
  /** @type {string | undefined} */ changes;
  /** @type {number | null} */ pressed;
  /** @type {import("gpui-base").ScrollHandle} */ scroll;
  /** @type {Record<string, unknown>} */ panels;
  /** @type {Swipe} */ swipe;
  /** @type {boolean | undefined} */ opening;
  /** @type {string | undefined} */ space;
  /** @type {PendingPanel | null | undefined} */ pending;
  /** @type {string | undefined} */ selected;
  /** @type {number | undefined} */ selectedIndex;

  /** @param {import("gpui-shell").Props | undefined} config @param {import("gpui-kit").AsyncContext} cx */
  init(config, cx) {
    /** @type {unknown} */
    const changes = config?.terminal ?? props()?.terminal;
    if (changes !== undefined && changes !== null && typeof changes !== "string") throw new Error("Invalid Changes terminal");
    this.changes = typeof changes === "string" ? changes : undefined;
    if (this.changes) {
      /** @type {unknown} */
      const overlay = config?.overlay ?? props()?.overlay;
      if (typeof overlay !== "string") throw new Error("Missing Changes overlay");
      const terminal = this.changes;
      cx.timer.every(1000, () => {
        if (!hasLiveTerminal(terminal)) closeOverlay(overlay);
      });
      return;
    }
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    /** @type {unknown} */
    let panels;
    try { panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { panels = {}; }
    this.panels = isRecord(panels) ? panels : {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
  }

  close() {
    const terminal = this.changes;
    if (terminal && hasLiveTerminal(terminal)) run("terminal.kill", { terminal });
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  openChanges(cx) {
    if (this.opening) return;
    const space = spaces().find(s => s.active), f = focused();
    const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd || space?.folder;
    const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
    if (!cwd) { notify({ title: "Cannot open Changes", body: "No folder selected", level: "error" }); return; }
    this.opening = true;
    cx.spawn(async () => {
      try {
        const args = ["run", "--json", "--bg", "--rm", "--cwd", cwd];
        if (on) args.push("--on", on);
        args.push("--", "bash", "-c", 'exec bash "$HOME/.config/herdr-app/mods/tabs-files/changes-diff.sh"');
        const result = await exec("hc", args);
        if (result.code !== 0) throw new Error(result.stderr || "Cannot start Changes");
        const response = JSON.parse(result.stdout);
        if (!isRecord(response) || typeof response.address !== "string" || !response.address) throw new Error("No terminal address returned");
        const terminal = response.address;
        try {
          openOverlay({ kind: "dialog", frame: "none", width: 0.8, height: 0.8, layout: { type: "column", background: "#1e1e2eeb", radius: 0, children: [
            { type: "block", size: { px: 0 }, content: { mod: "tabs-files", props: { terminal } } },
            { type: "block", content: { terminal } },
          ] } });
        } catch (e) {
          await exec("hc", ["kill", terminal]);
          throw e;
        }
      } catch (e) { notify({ title: "Cannot open Changes", body: String(e), level: "error" }); }
      finally { this.opening = false; }
    });
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  /** @param {import("gpui-kit").ScrollWheelEvent} e */
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // Remember which right-side panes are visible in each space.
  /** @param {import("herdr").SpaceInfo | undefined} space @param {LayoutNode | null} panel */
  syncPanel(space, panel) {
    if (!space || !panel) return;
    const now = panelMask(panel);
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id];
        const want = stored === "files" || stored === "git" ? 3 : typeof stored === "number" && Number.isInteger(stored) && stored >= 0 && stored <= 3 ? stored : 0;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          showPanel(want);
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  /** @param {string} id @param {import("herdr").SpaceInfo | undefined} space @param {LayoutNode | null} panel */
  togglePanel(id, space, panel) {
    if (!space || !panel) return;
    const want = (this.pending?.want ?? panelMask(panel)) ^ (id === "files" ? 1 : 2);
    this.pending = { want, until: Date.now() + 1000 };
    this.panels[space.id] = want;
    localStorage.setItem("panels", JSON.stringify(this.panels));
    showPanel(want);
  }

  /** @returns {import("gpui-kit").Element} */
  render() {
    if (this.changes) return div();
    const t = checkedTheme(theme());
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    /** @type {Set<string>} */
    const managed = new Set(terminals().filter(t => isTerminal(t) && t.state === "live" && t.parent && t.labels?.["herdr.supervised"] === "1").map(t => t.address));
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    /** @param {import("gpui-kit").MouseButtonEvent} _e @param {import("gpui-kit").Context} cx */
    const stop = (_e, cx) => cx.stop_propagation();
    /** @param {string} id @param {string | import("gpui-kit").Element} label @param {() => void} action @returns {import("gpui-kit").Element} */
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    /** @param {import("herdr").TabInfo} c @param {number} i @returns {import("gpui-kit").Element} */
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const supervised = panes().some(p => p.tab === c.id && p.terminal !== null && managed.has(p.terminal));
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(supervised ? withAlpha(t.accent, c.active ? "45" : "30") : c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu-square", frame: "none", kind: "popup", width: 200, props: { square: true, tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), lights = trafficLights(root), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && lights
      ? Math.max(10, (lights[0] + 64) / zoom() - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel");
    this.syncPanel(space, panel);
    /** @param {"files" | "git" | "changes"} id @param {string} label @param {string} icon @param {((event: import("gpui-kit").ClickEvent, cx: import("gpui-kit").Context) => void)} [action] @returns {import("gpui-kit").Element} */
    const panelButton = (id, label, icon, action) => {
      const on = !action && Boolean(panelMask(panel) & (id === "files" ? 1 : 2));
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center()
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(action ?? (() => this.togglePanel(id, space, panel))).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu-square", frame: "none", kind: "popup", width: 250, height: 512 })))
      .child(panelButton("files", "Files", "mods/files/file.svg"))
      .child(panelButton("git", "Git", "mods/git-graph/branch.svg"))
      .child(panelButton("changes", "Changes", "mods/changes/changes.svg", (_e, cx) => this.openChanges(cx)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
