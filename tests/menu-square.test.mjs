import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/menu-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("/** @typedef {import(\"herdr\").SpaceInfo}");
const end = source.indexOf("export default class Menu", start);
assert.ok(start >= 0 && end > start);

let termList = [];
let paneList = [];
let gitTop = "/repo";
let gitCommon = "/repo/.git";
let gitCode = 0;
const api = runInNewContext(`${source.slice(start, end)}\n({ items, checkout, menuProps, themeColor, shortcut })`, {
  terminals: () => termList,
  panes: () => paneList,
  spaces: () => [],
  keys: () => [{ section: "global", action: "pane.split:right", keys: "ctrl-r" }],
  exec: async (_command, args) => ({ code: gitCode, stdout: args[1] === "--show-toplevel" ? `${gitTop}\n` : `${gitCommon}\n`, stderr: "" }),
});

assert.deepEqual(Array.from(api.items({ tab: "tab", target: { id: "t1", space: "s1" } }, null), item => item[1]), ["tab.rename", "tab.new", "tab.close"]);
assert.deepEqual(Array.from(api.items({ tab: "space", target: { id: "s1" } }, "main"), item => item[1]), ["space.rename", "worktree", "worktree", "space.close"]);
assert.deepEqual(Array.from(api.items({ tab: "space", target: { id: "s1" } }, "linked"), item => item[2].action).filter(Boolean), ["new", "open", "remove"]);
assert.deepEqual(Array.from(api.items({ tab: "global" }, null), item => item[1]), ["space.new", "app.help", "app.theme", "app.theme", "app.theme", "app.theme"]);

termList = [];
paneList = [{ pane: "p1" }];
assert.deepEqual(Array.from(api.items({ tab: "pane", target: { pane: "p1", terminal: null } }, null), item => item[1]), ["pane.split", "pane.split", "pane.zoom", "pane.close"]);

termList = [
  { address: "parent", name: "Parent", labels: {} },
  { address: "child", parent: "parent", name: "Child", labels: { "herdr.right-click": "program" } },
];
paneList = [{ pane: "p1" }];
assert.deepEqual(Array.from(api.items({ tab: "pane", target: { pane: "p1", terminal: "child" } }, null), item => item[1]), ["pane.split", "pane.split", "pane.zoom", "terminal.right_click", "terminal.park", "pane.close"]);
assert.throws(() => api.items({ tab: "space", target: { id: 3 } }, null), /Invalid menu target/);
assert.throws(() => api.items({ tab: "pane", target: { pane: null } }, null), /Invalid menu target/);
assert.throws(() => api.items({ tab: "invalid" }, null), /Invalid menu tab/);
assert.equal(api.menuProps(null).tab, "global");
assert.throws(() => api.themeColor({ popover: "blue" }, "popover"), /Invalid theme color/);
assert.equal(await api.checkout("/repo", null), "main");
gitTop = "/repo/worktrees/feature";
assert.equal(await api.checkout(gitTop, null), "linked");
gitCode = 1;
assert.equal(await api.checkout("/not-a-repo", null), null);
assert.equal(api.shortcut("pane.split", { direction: "right" }), "ctrl-r");
