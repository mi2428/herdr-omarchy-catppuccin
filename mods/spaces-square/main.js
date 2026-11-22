// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Attention counts live here; agent details stay in Agents. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

/** @typedef {import("herdr").SpaceInfo} Space */
/** @typedef {import("herdr").PaneInfo} Pane */
/** @typedef {import("herdr").AgentInfo} Agent */
/** @typedef {{address: string, parent?: string | null, state: string, status?: string | null, labels?: Record<string, string> | null}} LiveTerminal */
/** @typedef {{blocked: number, review: number}} Attention */
/** @typedef {{name: string, branch: string, ahead: number, behind: number, repo: string, linked: boolean}} GitInfo */
/** @typedef {{name: string, target: string, state: string, why?: string, via?: boolean, session?: string, temporary?: boolean, keeps_running_after_logout?: boolean, version?: string}} Machine */
/** @typedef {{machine: Machine, removed: boolean, busy?: boolean, error?: string | null}} Reconnect */
/** @typedef {{w: Space, i: number, g: GitInfo | null, tree?: string | null}} SpaceRow */
/** @typedef {Record<string, `#${string}`>} ThemeColors */
/** @typedef {{id?: string, children?: unknown[], size?: {px?: number} | null}} LayoutNode */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Machine} */
function isMachine(value) {
  return isRecord(value) && typeof value.name === "string" && typeof value.target === "string" && typeof value.state === "string"
    && (value.why === undefined || typeof value.why === "string") && (value.via === undefined || typeof value.via === "boolean")
    && (value.session === undefined || typeof value.session === "string") && (value.temporary === undefined || typeof value.temporary === "boolean")
    && (value.keeps_running_after_logout === undefined || typeof value.keeps_running_after_logout === "boolean")
    && (value.version === undefined || typeof value.version === "string");
}

/** @param {unknown} value @returns {Machine[]} */
function machineList(value) {
  if (!isRecord(value) || !Array.isArray(value.machines)) throw new Error("Invalid machine list from hc.");
  return value.machines.map((item) => {
    if (!isMachine(item)) throw new Error("Invalid machine entry from hc.");
    return item;
  });
}

/** @param {string} value @returns {value is `#${string}`} */
function isColor(value) {
  return value.startsWith("#");
}

/** @param {string} value @param {string} name @returns {`#${string}`} */
function themeColor(value, name) {
  if (!isColor(value)) throw new Error(`Invalid theme color: ${name}`);
  return value;
}

/** @returns {ThemeColors} */
function themeColors() {
  return Object.fromEntries(Object.entries(theme()).map(([name, value]) => [name, themeColor(value, name)]));
}

/** @param {unknown} value @returns {value is LiveTerminal} */
function isLiveTerminal(value) {
  return isRecord(value) && typeof value.address === "string" && typeof value.state === "string"
    && (value.parent === undefined || value.parent === null || typeof value.parent === "string")
    && (value.status === undefined || value.status === null || typeof value.status === "string")
    && (value.labels === undefined || value.labels === null || (isRecord(value.labels) && Object.values(value.labels).every(label => typeof label === "string")));
}

/** @param {unknown[]} values @returns {LiveTerminal[]} */
function liveTerminals(values) {
  return values.map((value) => {
    if (!isLiveTerminal(value)) throw new Error("Invalid terminal data from Herdr.");
    return value;
  });
}

/** @param {unknown} value @returns {Record<string, string>} */
function spaceColors(value) {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Invalid shared space colors.");
  /** @type {Record<string, string>} */ const colors = {};
  for (const [id, color] of Object.entries(value)) {
    if (typeof color !== "string") throw new Error("Invalid shared space color.");
    colors[id] = color;
  }
  return colors;
}

/** @param {unknown} value @returns {value is Reconnect} */
function isReconnect(value) {
  return isRecord(value) && isMachine(value.machine) && typeof value.removed === "boolean"
    && (value.busy === undefined || typeof value.busy === "boolean")
    && (value.error === undefined || value.error === null || typeof value.error === "string");
}

/** @param {unknown} value @returns {Record<string, Reconnect>} */
function reconnectMap(value) {
  if (!isRecord(value)) throw new Error("Invalid reconnect state.");
  /** @type {Record<string, Reconnect>} */ const states = {};
  for (const [name, state] of Object.entries(value)) {
    if (!isReconnect(state)) throw new Error("Invalid reconnect state.");
    states[name] = state;
  }
  return states;
}

/** @param {unknown} value @returns {Set<string | null>} */
function foldedMachines(value) {
  if (!Array.isArray(value) || !value.every(name => name === null || typeof name === "string")) throw new Error("Invalid folded machines.");
  return new Set(value);
}

/** @param {unknown} value @returns {value is LayoutNode} */
function isLayoutNode(value) {
  return isRecord(value)
    && (value.id === undefined || typeof value.id === "string")
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

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
/** @param {Space} s @param {Pane[]} ps */
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
/** @param {{tree?: string | null}} row */
const rowHeight = ({ tree }) => (tree ? 22 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
/** @param {import("gpui-kit").Element} el */
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
/** @param {Space} s @param {Pane[]} ps */
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
/** @param {string} path */
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
/** @template A, B @param {Promise<A>} a @param {Promise<B>} b @returns {Promise<[A, B]>} */
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  if (done[0].status === "rejected") throw done[0].reason;
  if (done[1].status === "rejected") throw done[1].reason;
  return [done[0].value, done[1].value];
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
/** @type {Record<string, `#${string}`>} */
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
/** @param {string | null} status @returns {string} */
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

/** @param {ThemeColors} t @param {string | null} status @returns {`#${string}`} */
export function tone(t, status) {
  return t[status] ?? t.unknown;
}

/** @param {Space[]} sp @param {Agent[]} listed @param {LiveTerminal[]} all @returns {Map<string, Attention>} */
export function attentionBySpace(sp, listed, all) {
  const counts = new Map(sp.map(s => [s.id, { blocked: 0, review: 0 }]));
  const byAddress = new Map(listed.map(a => [a.address, a]));
  const live = new Map(all.filter(t => t.state === "live").map(t => [t.address, t]));
  /** @param {LiveTerminal | undefined} t @returns {string | null} */
  const spaceOf = (t) => {
    const seen = new Set();
    while (t && !seen.has(t.address)) {
      seen.add(t.address);
      const id = byAddress.get(t.address)?.space ?? t.labels?.["herdr.space"];
      if (id && counts.has(id)) return id;
      t = live.get(t.parent);
    }
    return null;
  };
  for (const a of listed) if (a.status === "blocked" && counts.has(a.space)) counts.get(a.space).blocked++;
  for (const t of live.values()) {
    const id = spaceOf(t);
    if (!id) continue;
    if (!byAddress.has(t.address) && (t.status === "blocked" || t.status === "error")) counts.get(id).blocked++;
    if (t.labels?.["herdr.supervised"] === "1" && t.labels?.["herdr.review"] === "pending") counts.get(id).review++;
  }
  return counts;
}

export default class Spaces extends View {
  /** @param {unknown} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    /** @type {Record<string, GitInfo | null>} */ this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    /** @type {Record<string, number>} */ this.checked = {}; // where() -> when it was last looked at
    /** @type {Set<string>} */ this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    /** @type {Set<string>} */ this.pending = new Set(); // where()s to look at next
    /** @type {Record<string, boolean>} */ this.busy = {}; // pane -> an agent working or a program in front of its shell
    /** @type {Record<string, boolean>} */ this.ready = {}; // machine -> its layout was readable at the last look
    /** @type {Record<string, string>} */ this.at = {}; // space -> its where() at the last look
    /** @type {Map<string, import("herdr").FolderWatch>} */ this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    /** @type {Record<string, number>} */ this.born = {};
    /** @type {string | null} */ this.pressed = null;
    /** @type {string | null} */ this.over = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1;
    /** @type {Set<string>} */ this.foldedSpaces = new Set();
    /** @type {{key: string, at: number, machines: (string | null)[]} | null} */ this.ordering = null;
    /** @type {string | undefined} */ this.revealed = undefined;
    this.revealedAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    /** @type {Machine[]} */ this.machines = [];
    try {
      /** @type {Record<string, Reconnect>} */ this.reconnecting = reconnectMap(JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}"));
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { /** @type {Record<string, Reconnect>} */ this.reconnecting = {}; }
    try { this.folded = foldedMachines(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  /** @param {number} now @param {Space[]} sp @param {Pane[]} ps @returns {Set<string>} */
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    /** @type {Record<string, string>} */ const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    /** @type {Record<string, Space>} */ const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    /** @type {Record<string, boolean>} */ const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  /** @param {string} key @param {Set<string>} keys @returns {string[]} */
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = machineList(JSON.parse(r.stdout)).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  /** @param {Machine | undefined} machine @returns {boolean} */
  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  /** @param {Machine} machine @param {import("gpui-kit").AsyncContext} cx */
  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        /** @param {string[]} args */
        const ask = async (args) => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  /** @param {Iterable<string>} keys @param {import("gpui-kit").AsyncContext} cx */
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  /** @param {string} key @param {import("gpui-kit").AsyncContext} cx */
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  /** @param {string} repo @param {import("gpui-kit").AsyncContext} cx */
  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  /** @param {Space} w */
  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu-square", frame: "none", kind: "popup", width: 200, height: 260, props: { square: true, tab: "space", target: { id: w.id } } });
  }

  /** @param {number} now @returns {boolean} */
  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
/** @returns {SpaceRow[]} */
  ordered() {
    const sp = spaces(), ps = panes();
    /** @param {Space} w */
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    /** @param {SpaceRow} r */
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    /** @type {SpaceRow[]} */ const out = [];
    /** @type {Set<string>} */ const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      /** @type {Set<string | null>} */ const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  /** @param {ThemeColors} t @param {boolean} collapsed @returns {import("gpui-kit").Element[]} */
  grouped(t, collapsed) {
    const ordered = this.ordered();
    const parents = new Set(ordered.filter((r, i) => !r.tree && ordered[i + 1]?.tree).map(r => r.w.id));
    let parent = "";
    const rows = collapsed ? ordered : ordered.filter(r => {
      if (!r.tree) { parent = r.w.id; return true; }
      return !this.foldedSpaces.has(parent);
    });
    /** @param {SpaceRow} r @returns {import("gpui-kit").Element} */
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t, parents.has(r.w.id)));
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    /** @param {string | null} m */
    const loading = (m) => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    /** @param {string | null} m @returns {import("gpui-kit").Element} */
    const loadingRow = (m) => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex(r => r.w.active);
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center()
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      /** @type {(el: import("gpui-kit").Element) => import("gpui-kit").Element} */
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(r => r.w.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  /** @param {GitInfo} g @param {string | null} tree @param {string} name @param {ThemeColors} t */
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    /** @param {string} a */
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  /** @param {SpaceRow} row @param {ThemeColors} t @param {boolean} [hasKids] */
  row({ w, i, g, tree }, t, hasKids = false) {
    const on = w.active;
    const attention = this.attention.get(w.id);
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = spaceColors(shared("space.colors"));
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? themeColor(color, "space color") : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .mb(tree ? 0 : 4)
      .flex_none()
      .justify_center()

      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        /** @type {string | null} */ this.pressed = null;
        /** @type {string | null} */ this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name))
          .when(hasKids, el => el.child(div().id(`space-fold-${w.id}`).flex_none().cursor_pointer().text_color(t.dim)
            .hover(s => s.text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => {
              cx.stop_propagation();
              this.foldedSpaces.has(w.id) ? this.foldedSpaces.delete(w.id) : this.foldedSpaces.add(w.id);
              cx.notify();
            })
            .child(svg(`mods/workspace-chrome/chevron-${this.foldedSpaces.has(w.id) ? "right" : "down"}.svg`).size(11).flex_none())))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(attention?.blocked > 0, el => el.child(div().flex_none().text_size(10.5).text_color(t.blocked)
            .tooltip(`${attention.blocked} agents need you`).child(`!${attention.blocked}`)))
          .when(attention?.review > 0, el => el.child(div().flex_none().text_size(10.5).text_color(t.accent)
            .tooltip(`${attention.review} reviews pending`).child(`R${attention.review}`))),
      );
  }

  /** @param {{w: Space, i: number}} row @param {ThemeColors} t */
  compact({ w, i }, t) {
    const attention = this.attention.get(w.id);
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)

      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .when(attention?.blocked > 0 || attention?.review > 0, el => el.tooltip(`${attention.blocked} need you · ${attention.review} reviews pending`))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = themeColors();
    const collapsed = narrow();
    /** @type {string[]} */ const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    this.attention = attentionBySpace(sp, agents(), liveTerminals(terminals()));
    const ids = new Set(sp.map(p => p.id));
    const storedColors = spaceColors(shared("space.colors"));
    const kept = Object.fromEntries(Object.entries(storedColors).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(storedColors).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      /** @param {string} c */
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("scrolling").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(list));
  }
}
