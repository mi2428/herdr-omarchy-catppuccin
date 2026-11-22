import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/new-menu-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("const KNOWN = ");
const end = source.indexOf("export default class NewMenu", start);
assert.ok(start >= 0 && end > start);
let platform = "linux", overlay = "ov1";
const bindings = [
  { section: "global", action: "open", keys: "ctrl-shift-o alt-- secondary-s" },
  { section: "global", action: "mac", keys: "super-n" },
];
const api = runInNewContext(`${source.slice(start, end)}\n({ agentCache, shortcut, themeColor, overlayId })`, {
  keys: () => bindings,
  window: () => ({ platform }),
  props: () => ({ overlay }),
});

assert.equal(api.shortcut("open"), "Ctrl+Shift+O Alt+- Ctrl+S");
platform = "macos";
assert.equal(api.shortcut("mac"), "⌘N");
const cached = api.agentCache({ local: [{ key: "codex", name: "Codex", icon: null, tint: false, run: ["codex"], installed: true }] });
assert.equal(cached.local[0].name, "Codex");
assert.deepEqual(Array.from(Object.keys(api.agentCache(null))), []);
assert.throws(() => api.agentCache("broken"), /Invalid cached agent map/);
assert.throws(() => api.agentCache({ local: [{ key: "codex" }] }), /Invalid cached agents for local/);
assert.equal(api.themeColor({ dim: "#cdd6f4" }, "dim"), "#cdd6f4");
assert.throws(() => api.themeColor({ dim: "blue" }, "dim"), /Invalid theme color: dim/);
assert.equal(api.overlayId(), "ov1");
overlay = undefined;
assert.throws(() => api.overlayId(), /missing its overlay id/);
