import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/workspace-status-square/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class WorkspaceStatus", "class WorkspaceStatus");
const now = Date.parse("2026-11-22T04:00:00Z"), iso = new Date(now).toISOString();
let output, calls = 0, pending;
const icons = [];
const node = () => {
  const el = new Proxy({}, { get: (_, key) => key === "when" ? (yes, fn) => { if (yes) fn(el); return el; } : () => el });
  return el;
};
const { quotaSnapshot, Status } = runInNewContext(`${source}\n({ quotaSnapshot, Status: WorkspaceStatus })`, {
  View: class {}, Date, Number, Array, Error, JSON,
  checking: () => false,
  props: () => ({}),
  h_flex: node, div: node, svg: path => { icons.push(path); return node(); }, spaces: () => [], agents: () => [], theme: () => ({}), keys: () => [], window: () => ({}),
  exec: async (command, args, options) => {
    assert.equal(command, "codexbar");
    assert.deepEqual(Array.from(args), ["dashboard", "--no-cost", "--identity", "redacted", "--timeout", "12"]);
    assert.equal(options.timeout, 15000);
    calls++;
    return { code: 0, stdout: JSON.stringify(output) };
  },
});

output = { schemaVersion: 1, generatedAt: iso, providers: [
  { id: "codex", enabled: true, updatedAt: iso, error: null, windows: [
    { kind: "session", remainingPercent: 0, resetAt: iso }, { kind: "weekly", remainingPercent: 79, resetAt: iso },
  ] },
  { id: "claude", enabled: true, updatedAt: iso, error: { message: "auth" }, windows: [{ kind: "session", remainingPercent: 80 }] },
  { id: "opencodego", enabled: true, source: "api", updatedAt: iso, error: null, windows: [
    { kind: "session", remainingPercent: 25 }, { kind: "monthly", remainingPercent: 68 },
  ] },
  { id: "opencode", enabled: true, updatedAt: iso, error: null, credits: { remaining: 0, unit: "USD" } },
] };
const valid = quotaSnapshot(output, now);
assert.equal(valid.codex.session.remaining, 0);
assert.equal(valid.codex.weekly.remaining, 79);
assert.equal(valid.claude, undefined);
assert.equal(valid.opencodego.monthly.remaining, 68);
assert.equal(valid.zen, 0);
assert.equal(valid.opencodego.weekly, undefined);
output.providers[2].source = "local";
assert.equal(quotaSnapshot(output, now).opencodego, undefined);
output.providers[2].source = "api";
assert.throws(() => quotaSnapshot({ ...output, generatedAt: new Date(now - 300000).toISOString() }, now), /Invalid usage snapshot/);
assert.throws(() => quotaSnapshot({ ...output, schemaVersion: 2 }, now), /Invalid usage snapshot/);
output.providers[0].windows[0].remainingPercent = 102;
assert.equal(quotaSnapshot(output, now).codex.session, undefined);
output.providers[0].windows[0].remainingPercent = 0;
output.providers[3].credits.unit = "tokens";
assert.equal(quotaSnapshot(output, now).zen, undefined);
output.providers[3].credits.unit = "USD";
output.generatedAt = new Date().toISOString();
for (const provider of output.providers) provider.updatedAt = output.generatedAt;

const view = new Status(), timers = [];
view.init(null, { timer: { every: (ms, fn) => timers.push([ms, fn]) }, spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
assert.deepEqual(Array.from(view.usageProviders), ["codex"]);
const visible = [];
view.meter = (_id, name) => { visible.push(name); return name; };
view.hint = () => "commands";
view.render();
assert.deepEqual(visible, ["Codex"]);
assert.equal(calls, 1);
assert.equal(view.usage.zen, 0);
assert.equal(timers.length, 1);
assert.equal(timers[0][0], 60000);
timers[0][1]({ spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
assert.equal(calls, 2);

const selected = new Status();
selected.init({ usageProviders: ["claude", "go", "zen"] }, { timer: { every() {} }, spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
const chosen = [];
selected.meter = (_id, name) => { chosen.push(name); return name; };
selected.hint = () => "commands";
selected.render();
assert.deepEqual(chosen, ["Claude", "Go"]);
for (const [id, name] of [["codex", "Codex"], ["claude", "Claude"], ["opencodego", "Go"]])
  Status.prototype.meter.call(view, id, name, {});
assert.deepEqual(icons.filter(path => path.startsWith("icons/")),
  ["icons/opencode.svg", "icons/agent.svg", "icons/claude.svg", "icons/opencode.svg"]);
assert.equal(calls, 3);

const noUsage = new Status();
noUsage.init({ usageProviders: [] }, { timer: { every() { throw Error("Unexpected refresh"); } }, spawn() { throw Error("Unexpected fetch"); } });
assert.equal(calls, 3);
assert.throws(() => new Status().init({ usageProviders: ["go", "go"] }, {}), /Invalid usageProviders/);
assert.throws(() => new Status().init({ usageProviders: ["other"] }, {}), /Invalid usageProviders/);
const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
const status = (function find(node) { return node.id === "status" ? node : node.children?.map(find).find(Boolean); })(layout);
assert.deepEqual(status.content.props.usageProviders, ["codex"]);
