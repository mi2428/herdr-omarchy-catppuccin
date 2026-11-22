import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/workspace-chrome-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("/** @typedef {{id?: string");
const end = source.indexOf("export default class WorkspaceChrome", start);
assert.ok(start >= 0 && end > start);
let tree = { id: "root", children: [{ id: "sidebar", size: { px: 200 } }] };
let savedWidth = 212;
const calls = [];
const { find, narrow, toggleSidebar, themeColor } = runInNewContext(`${source.slice(start, end)}\n({ find, narrow, toggleSidebar, themeColor })`, {
  layout: () => tree,
  shared: () => savedWidth,
  setShared: (key, value) => { calls.push(["set", key, value]); if (key === "sidebar.width") savedWidth = value; },
  run: (name, args) => calls.push(["run", name, args]),
  window: () => ({ platform: "linux" }),
});

assert.equal(find(tree, "sidebar").id, "sidebar");
assert.equal(find(null, "sidebar"), null);
assert.equal(narrow(), false);
toggleSidebar();
assert.deepEqual(calls.map(([kind, key, value]) => [kind, key, typeof value === "object" ? { ...value } : value]), [
  ["set", "sidebar.width", 200],
  ["set", "sidebar.collapsed", true],
  ["run", "layout.resize", { id: "sidebar", px: 44 }],
]);
tree.children[0].size.px = 120;
calls.length = 0;
assert.equal(narrow(), true);
toggleSidebar();
assert.deepEqual(calls.map(([kind, key, value]) => [kind, key, typeof value === "object" ? { ...value } : value]), [
  ["set", "sidebar.collapsed", false],
  ["run", "layout.resize", { id: "sidebar", px: 200 }],
]);
assert.equal(themeColor({ dim: "#cdd6f4" }, "dim"), "#cdd6f4");
assert.throws(() => themeColor({ dim: "not-a-color" }, "dim"), /Invalid theme color: dim/);
