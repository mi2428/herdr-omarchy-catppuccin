import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/git-graph/history.js", import.meta.url), "utf8");
const { parseHistory, graphRows, worktreeRows, countChanges, relativeTime } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const [merge, branch, trunk, base] = "abcd".split("").map(c => c.repeat(40));
const text = [
  `${merge}\x1f${trunk} ${branch}\x1f1795270868\x1fHEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\x1fMerge branch`,
  `${branch}\x1f${base}\x1f1795270800\x1frefs/heads/feature\x1fFeature`,
  `${trunk}\x1f${base}\x1f1795270700\x1f\x1fTrunk`,
  `${base}\x1f\x1f1795270600\x1f\x1fBase`,
].map(s => `\x1e${s}\n`).join("");
const commits = parseHistory(text);
assert.equal(commits[0].title, "Merge branch");
assert.equal(commits[0].seconds, 1795270868);
assert.deepEqual(commits[0].refs, [
  { kind: "head", name: "main" }, { kind: "tag", name: "v1" }, { kind: "remote", name: "origin/main" },
]);
assert.deepEqual(commits[1].refs, [{ kind: "branch", name: "feature" }]);
const { rows, columns } = graphRows(commits);
assert.equal(columns, 2);
assert.deepEqual(rows.map(row => row.col), [0, 1, 0, 1]);
assert.ok(rows[0].links.some(([a, , b]) => a === 0 && b === 1));
assert.ok(rows[2].links.some(([a, , b]) => a === 0 && b === 1));
const working = worktreeRows(rows, 2);
assert.equal(working[0].title, "Uncommitted changes (2)");
assert.equal(working[0].worktreeLink, true);
assert.equal(working[1].worktreeTarget, true);
assert.equal(working[2].worktreeLink, false);
assert.equal(working[0].col, working[1].col);
const laterHead = worktreeRows([{ ...rows[0], refs: [] }, { ...rows[1], refs: [{ kind: "head", name: "feature" }] }], 1);
assert.equal(laterHead[0].col, 1);
assert.equal(laterHead[1].worktreeCol, 1);
assert.equal(laterHead[2].worktreeCol, 1);
assert.strictEqual(worktreeRows(rows, 0), rows);
assert.equal(worktreeRows([], 1)[0].worktreeLink, false);
assert.deepEqual(worktreeRows([{ ...rows[1], refs: [] }, rows[0]], 1).map(r => Boolean(r.worktreeLink)), [true, true, true]);
assert.equal(countChanges(" M changed\0?? untracked\0R  new\0old\0"), 3);
assert.equal(countChanges(""), 0);
assert.throws(() => countChanges("R  new\0"), /Unexpected git status output/);
const now = 1_800_000_000_000;
for (const [age, expected] of [[0, "now"], [60, "1m"], [3600, "1h"], [86400, "1d"], [2592000, "1mo"], [31536000, "1y"]])
  assert.equal(relativeTime(now / 1000 - age, now), expected);
assert.throws(() => parseHistory("\x1einvalid\x1f\x1f0\x1f\x1fTitle"), /Unexpected git log output/);

const graphSource = readFileSync(new URL("../mods/git-graph/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class GitGraph", "class GitGraph");
const calls = [];
let hasHead = true, statusText = " M a\0?? b\0";
const Graph = runInNewContext(`${graphSource}\nGitGraph`, {
  View: class {}, spaces: () => [{ active: true, folder: "/repo" }],
  focused: () => ({ pane: null, cwd: "/repo", terminal: null }), panes: () => [],
  exec: async (_program, args) => {
    calls.push(Array.from(args));
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n" };
    if (args.includes("--verify")) return hasHead ? { code: 0, stdout: merge } : { code: 1, stderr: "No HEAD" };
    if (args.includes("symbolic-ref")) return { code: 0, stdout: "refs/heads/main" };
    if (args.includes("log")) return { code: 0, stdout: text };
    if (args.includes("status")) return { code: 0, stdout: statusText };
    throw Error("Unexpected git command");
  }, parseHistory, graphRows, worktreeRows, countChanges, relativeTime,
});
const graph = new Graph();
const timers = [], ticking = new Graph();
ticking.refresh = () => {};
ticking.init(null, { timer: { every: (ms, fn) => timers.push([ms, fn]) } });
assert.deepEqual(timers.map(([ms]) => ms), [10000, 60000]);
let notices = 0;
timers[1][1]({ notify: () => { notices++; } });
assert.equal(notices, 1);
graph.limit = 200;
let pending;
graph.refresh({ spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
assert.equal(graph.rows[0].title, "Uncommitted changes (2)");
assert.equal(graph.columns, columns);
assert.ok(calls.find(args => args.includes("status")).includes("--renames"));
statusText = "";
graph.refresh({ spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
assert.equal(graph.rows.length, rows.length);
assert.equal(graph.columns, columns);
hasHead = false; statusText = "?? first.txt\0"; calls.length = 0;
graph.refresh({ spawn: fn => { pending = fn({ notify() {} }); } });
await pending;
assert.equal(graph.rows.length, 1);
assert.equal(graph.rows[0].title, "Uncommitted changes (1)");
assert.equal(graph.rows[0].worktreeLink, false);
assert.equal(calls.some(args => args.includes("log")), false);

const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
const panel = find(layout, "panel-body");
assert.equal(panel.type, "column");
assert.equal(panel.gap, find(layout, "sidebar-lists").gap);
assert.deepEqual(panel.children.map(child => [child.id, child.size.weight]), [["files", 1], ["git", 1]]);
const mocha = JSON.parse(readFileSync(new URL("../themes/catppuccin-mocha.json", import.meta.url), "utf8"));
for (const child of panel.children) assert.equal(child.background, "chrome");
assert.equal(find(layout, "panel").background, find(layout, "sidebar").background);
assert.equal(mocha.colors.canvas, "#00000000");

const tabsSource = readFileSync(new URL("../mods/tabs-files/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class Tabs", "class Tabs");
const actions = [], right = structuredClone(find(layout, "panel"));
const { Tabs, panelMask } = runInNewContext(`${tabsSource}\n({ Tabs, panelMask })`, {
  View: class {}, run: (action, { id }) => {
    actions.push([action, id]);
    find(right, id).hidden = action === "layout.hide";
  }, localStorage: { setItem() {} },
});
right.hidden = true;
const tabs = new Tabs();
tabs.panels = { previous: "git" };
tabs.syncPanel({ id: "previous" }, right);
assert.equal(panelMask(right), 3);
assert.deepEqual(actions, [["layout.show", "files"], ["layout.show", "git"], ["layout.show", "panel"]]);

const space = { id: "previous" };
for (const [button, visible] of [["files", 2], ["git", 0], ["files", 1], ["git", 3]]) {
  tabs.togglePanel(button, space, right);
  assert.equal(panelMask(right), visible);
  assert.equal(tabs.panels[space.id], visible);
}
assert.equal(right.hidden, false);
assert.equal(find(right, "files").hidden, false);
assert.equal(find(right, "git").hidden, false);
