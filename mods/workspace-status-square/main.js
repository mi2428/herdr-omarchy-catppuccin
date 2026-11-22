import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, checking } from "herdr";

const WINDOWS = ["session", "weekly"];
const validTime = (time, now) => {
  const age = now - Date.parse(time);
  return Number.isFinite(age) && age >= -60000 && age < 300000;
};

function quotaSnapshot(snapshot, now = Date.now()) {
  if (snapshot.schemaVersion !== 1 || !validTime(snapshot.generatedAt, now) || !Array.isArray(snapshot.providers))
    throw Error("Invalid usage snapshot");
  const result = {};
  for (const id of ["codex", "claude", "opencodego", "opencode"]) {
    const provider = snapshot.providers.find(p => p.id === id);
    if (!provider?.enabled || provider.error || !validTime(provider.updatedAt, now) ||
      (id === "opencodego" && provider.source === "local")) continue;
    if (id === "opencode") {
      const balance = provider.credits?.remaining;
      if (provider.credits?.unit === "USD" && typeof balance === "number" && Number.isFinite(balance)) result.zen = balance;
      continue;
    }
    result[id] = {};
    for (const kind of [...WINDOWS, ...(id === "opencodego" ? ["monthly"] : [])]) {
      const lane = provider.windows?.find(w => w.kind === kind);
      const n = lane?.remainingPercent;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100)
        result[id][kind] = { remaining: n, resetAt: lane.resetAt };
    }
  }
  return result;
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.usage = {};
    if (!checking()) {
      this.refresh(cx);
      cx.timer.every(60000, cx => this.refresh(cx));
    }
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const result = await exec("codexbar", ["dashboard", "--no-cost", "--identity", "redacted", "--timeout", "12"], { timeout: 15000 });
        if (result.code !== 0) throw Error("Usage fetch failed");
        this.usage = quotaSnapshot(JSON.parse(result.stdout));
      } catch { this.usage = {}; }
      finally { this.loading = false; cx.notify(); }
    });
  }

  meter(id, name, t) {
    const lane = this.usage[id] ?? {};
    const segment = (kind, label) => {
      const entry = lane[kind], remaining = entry?.remaining;
      const color = remaining <= 10 ? t.blocked : remaining <= 30 ? t.working : t.ansi2;
      return h_flex().gap(4).items_center().tooltip(entry
        ? `${name} ${label}: ${remaining.toFixed(1)}% remaining${Number.isFinite(Date.parse(entry.resetAt)) ? ` · Resets ${new Date(entry.resetAt).toLocaleString()}` : ""}`
        : `${name} ${label}: unavailable`)
        .child(div().text_color(t.dim).child(label))
        .child(div().w(36).h(4).rounded_full().bg(t.dim)
          .when(Boolean(entry), el => el.child(div().w(36 * remaining / 100).h(4).rounded_full().bg(color))))
        .child(div().w(28).text_right().text_color(entry ? t.muted : t.dim).child(entry ? `${Math.round(remaining)}%` : "—"));
    };
    return h_flex().gap(6).items_center().child(div().text_color(t.foreground).child(name))
      .child(segment("session", "5h")).child(segment("weekly", "7d"))
      .when(Boolean(lane.monthly), el => el.child(segment("monthly", "mo")));
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(this.meter("codex", "Codex", t))
      .child(this.meter("claude", "Claude", t))
      .child(this.meter("opencodego", "Go", t))
      .child(div().tooltip("OpenCode Zen prepaid balance (not a quota)").child(`Zen ${this.usage.zen === undefined ? "—" : `$${this.usage.zen.toFixed(2)}`}`))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
