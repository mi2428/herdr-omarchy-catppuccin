import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, checking, props } from "herdr";

/** @typedef {"codex" | "claude" | "go" | "zen"} UsageProvider */
/** @typedef {"codex" | "claude" | "opencodego" | "opencode"} DashboardProvider */
/** @typedef {"session" | "weekly" | "monthly"} WindowKind */
/** @typedef {{remaining: number, resetAt?: string | null}} UsageEntry */
/** @typedef {{session?: UsageEntry, weekly?: UsageEntry, monthly?: UsageEntry}} ProviderUsage */
/** @typedef {{codex?: ProviderUsage, claude?: ProviderUsage, opencodego?: ProviderUsage, zen?: number}} Usage */
/** @typedef {{kind?: string, remainingPercent?: unknown, resetAt?: string | null}} UsageWindow */
/** @typedef {{unit?: string | null, remaining?: unknown}} Credits */
/** @typedef {{id: string, enabled?: boolean | null, error?: unknown, updatedAt?: string | null, source?: string | null, windows?: UsageWindow[] | null, credits?: Credits | null}} UsageSource */
/** @typedef {Record<string, `#${string}`>} ThemeColors */

/** @type {UsageProvider[]} */
const USAGE_PROVIDERS = ["codex", "claude", "go", "zen"];
/** @type {DashboardProvider[]} */
const DASHBOARD_PROVIDERS = ["codex", "claude", "opencodego", "opencode"];
/** @type {WindowKind[]} */
const WINDOWS = ["session", "weekly"];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is UsageWindow} */
function isUsageWindow(value) {
  return isRecord(value) && (value.kind === undefined || typeof value.kind === "string")
    && (value.resetAt === undefined || value.resetAt === null || typeof value.resetAt === "string");
}

/** @param {unknown} value @returns {value is UsageSource} */
function isUsageSource(value) {
  return isRecord(value) && typeof value.id === "string"
    && (value.enabled === undefined || value.enabled === null || typeof value.enabled === "boolean")
    && (value.updatedAt === undefined || value.updatedAt === null || typeof value.updatedAt === "string")
    && (value.source === undefined || value.source === null || typeof value.source === "string")
    && (value.windows === undefined || value.windows === null || (Array.isArray(value.windows) && value.windows.every(isUsageWindow)))
    && (value.credits === undefined || value.credits === null || (isRecord(value.credits)
      && (value.credits.unit === undefined || value.credits.unit === null || typeof value.credits.unit === "string")));
}

/** @param {unknown} value @returns {value is UsageSource[]} */
function isUsageSources(value) {
  return Array.isArray(value) && value.every(isUsageSource);
}

/** @param {string} time @param {number} now @returns {boolean} */
const validTime = (time, now) => {
  const age = now - Date.parse(time);
  return Number.isFinite(age) && age >= -60000 && age < 300000;
};

/** @param {unknown} snapshot @param {number} [now] @returns {Usage} */
function quotaSnapshot(snapshot, now = Date.now()) {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || typeof snapshot.generatedAt !== "string"
    || !validTime(snapshot.generatedAt, now) || !isUsageSources(snapshot.providers)) throw Error("Invalid usage snapshot");
  /** @type {Usage} */ const result = {};
  for (const id of DASHBOARD_PROVIDERS) {
    const provider = snapshot.providers.find(p => p.id === id);
    if (!provider?.enabled || provider.error || typeof provider.updatedAt !== "string" || !validTime(provider.updatedAt, now) ||
      (id === "opencodego" && provider.source === "local")) continue;
    if (id === "opencode") {
      const balance = provider.credits?.remaining;
      if (provider.credits?.unit === "USD" && typeof balance === "number" && Number.isFinite(balance)) result.zen = balance;
      continue;
    }
    result[id] = {};
    /** @type {WindowKind[]} */ const kinds = [...WINDOWS];
    if (id === "opencodego") kinds.push("monthly");
    for (const kind of kinds) {
      const lane = provider.windows?.find(w => w.kind === kind);
      const remaining = lane?.remainingPercent;
      if (typeof remaining === "number" && Number.isFinite(remaining) && remaining >= 0 && remaining <= 100)
        result[id][kind] = { remaining, resetAt: lane.resetAt };
    }
  }
  return result;
}

/** @param {unknown} value @returns {value is UsageProvider} */
function isUsageProvider(value) {
  return typeof value === "string" && USAGE_PROVIDERS.some(provider => provider === value);
}

/** @param {unknown} value @returns {value is UsageProvider[]} */
function isUsageProviderList(value) {
  return Array.isArray(value) && value.every(isUsageProvider);
}

/** @param {unknown} config @param {unknown} modProps @returns {UsageProvider[]} */
function configuredProviders(config, modProps) {
  const configured = isRecord(config) ? config.usageProviders : undefined;
  const fromMod = isRecord(modProps) ? modProps.usageProviders : undefined;
  const value = configured ?? fromMod ?? ["codex"];
  if (!isUsageProviderList(value) || new Set(value).size !== value.length)
    throw Error("Invalid usageProviders: expected unique codex, claude, go, zen values");
  return value;
}

/** @param {string} value @returns {value is `#${string}`} */
function isColor(value) {
  return value.startsWith("#");
}

/** @param {string} value @param {string} name @returns {`#${string}`} */
function themeColor(value, name) {
  if (!isColor(value)) throw Error(`Invalid theme color: ${name}`);
  return value;
}

/** @returns {ThemeColors} */
function themeColors() {
  return Object.fromEntries(Object.entries(theme()).map(([name, value]) => [name, themeColor(value, name)]));
}

export default class WorkspaceStatus extends View {
  /** @param {unknown} config @param {import("gpui-kit").AsyncContext} cx */
  init(config, cx) {
    this.usageProviders = configuredProviders(config, props());
    /** @type {Usage} */ this.usage = {};
    if (!checking() && this.usageProviders.length) {
      this.refresh(cx);
      cx.timer.every(60000, cx => this.refresh(cx));
    }
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
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

  /** @param {"codex" | "claude" | "opencodego"} id @param {string} name @param {ThemeColors} t */
  meter(id, name, t) {
    const lane = this.usage[id] ?? {};
    /** @param {WindowKind} kind @param {string} label */
    const segment = (kind, label) => {
      const entry = lane[kind], remaining = entry?.remaining;
      const color = remaining <= 10 ? t.blocked : remaining <= 30 ? t.working : t.ansi2;
      return h_flex().gap(4).items_center().tooltip(entry
        ? `${name} ${label}: ${remaining.toFixed(1)}% remaining${typeof entry.resetAt === "string" && Number.isFinite(Date.parse(entry.resetAt)) ? ` · Resets ${new Date(entry.resetAt).toLocaleString()}` : ""}`
        : `${name} ${label}: unavailable`)
        .child(div().text_color(t.dim).child(label))
        .child(div().w(36).h(4).rounded_full().bg(t.dim)
          .when(Boolean(entry), el => el.child(div().w(36 * remaining / 100).h(4).rounded_full().bg(color))))
        .child(div().when(Boolean(entry), el => el.w(28).text_right()).text_color(entry ? t.muted : t.dim)
          .child(entry ? `${Math.round(remaining)}%` : "—"));
    };
    return h_flex().gap(6).items_center()
      .child(svg(`icons/${id === "codex" ? "agent" : id === "opencodego" ? "opencode" : id}.svg`)
        .size(13).flex_none().text_color(t.muted))
      .child(name)
      .child(segment("session", "5h")).child(segment("weekly", "7d"))
      .when(Boolean(lane.monthly), el => el.child(segment("monthly", "mo")));
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  /** @param {ThemeColors} t @returns {string} */
  hint(t) {
    const mac = window()?.platform === "macos";
    /** @type {Record<string, string>} */
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = themeColors();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    /** @param {string} icon @param {string} text @returns {import("gpui-kit").Element} */
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch ?? "")))
      .child(h_flex().gap(6).items_center().child(div().size(6).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(this.usageProviders.includes("codex"), el => el.child(this.meter("codex", "Codex", t)))
      .when(this.usageProviders.includes("claude"), el => el.child(this.meter("claude", "Claude", t)))
      .when(this.usageProviders.includes("go"), el => el.child(this.meter("opencodego", "Go", t)))
      .when(this.usageProviders.includes("zen"), el => el.child(h_flex().gap(4).items_center().tooltip("OpenCode Zen prepaid balance (not a quota)")
        .child(svg("icons/opencode.svg").size(13).flex_none().text_color(t.muted))
        .child("Zen").child(div().text_color(this.usage.zen === undefined ? t.dim : t.muted)
          .child(this.usage.zen === undefined ? "—" : `$${this.usage.zen.toFixed(2)}`))))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
