import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/git-graph/history.js", import.meta.url), "utf8");
const { parseHistory, graphRows } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
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
assert.throws(() => parseHistory("\x1einvalid\x1f\x1f0\x1f\x1fTitle"), /Unexpected git log output/);

const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
const panel = find(layout, "panel-body");
assert.equal(panel.type, "column");
assert.equal(panel.gap, find(layout, "sidebar-lists").gap);
assert.deepEqual(panel.children.map(child => [child.id, child.size.weight]), [["files", 1], ["git", 1]]);
const mocha = JSON.parse(readFileSync(new URL("../themes/catppuccin-mocha.json", import.meta.url), "utf8"));
for (const child of panel.children) assert.equal(child.background, mocha.background);
assert.match(find(layout, "panel").background, /^#[0-9a-f]{6}$/i);
assert.notEqual(find(layout, "panel").background, mocha.background);

const tabsSource = readFileSync(new URL("../mods/tabs-files/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class Tabs", "class Tabs");
const actions = [];
const Tabs = runInNewContext(`${tabsSource}\nTabs`, {
  View: class {}, run: action => actions.push(action), localStorage: { setItem() {} },
});
const tabs = new Tabs();
tabs.panels = { previous: "git" };
tabs.syncPanel({ id: "previous" }, { hidden: true });
assert.deepEqual(actions, ["layout.show"]);
