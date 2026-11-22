import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/spaces-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("export function attentionBySpace(");
const end = source.indexOf("\nexport default class Spaces", start);
assert.ok(start >= 0 && end > start);
const attentionBySpace = runInNewContext(`${source.slice(start, end).replace("export ", "")}\nattentionBySpace`);
const spaces = [{ id: "main" }, { id: "branch" }];
const agents = [
  { address: "t1", space: "main", status: "blocked" },
  { address: "t2", space: "branch", status: "working" },
  { address: "t3", space: "branch", status: "blocked" },
];
const terminals = [
  { address: "t1", state: "live", labels: {} },
  { address: "t2", state: "live", labels: { "herdr.supervised": "1", "herdr.review": "pending" } },
  { address: "t3", state: "live", labels: { "herdr.supervised": "1", "herdr.review": "reviewing" } },
  { address: "t4", state: "live", parent: "t2", status: "blocked", labels: {} },
  { address: "t5", state: "live", parent: "t4", status: "error", labels: {} },
  { address: "t6", state: "exited", parent: "t1", status: "blocked", labels: { "herdr.supervised": "1", "herdr.review": "pending" } },
  { address: "t7", state: "live", parent: "t1", status: "idle", labels: { "herdr.review": "pending" } },
];
const counts = attentionBySpace(spaces, agents, terminals);
assert.deepEqual({ ...counts.get("main") }, { blocked: 1, review: 0 });
assert.deepEqual({ ...counts.get("branch") }, { blocked: 3, review: 1 });
const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
assert.deepEqual(layout.children[0].children[1].children.map(n => n.id), ["spaces", "agents"]);

const element = () => {
  const node = { children: [] };
  const el = new Proxy(node, { get: (target, key) => key === "child" ? value => { target.children.push(value); return el; }
    : key === "when" ? (yes, fn) => { if (yes) fn(el); return el; }
    : key in target ? target[key] : () => el });
  return el;
};
const Spaces = runInNewContext(`${source.replace(/^import .*$/gm, "").replace(/export function /g, "function ").replace("export default class Spaces", "class Spaces")}\nSpaces`, {
  View: class {}, div: element, h_flex: element, v_flex: element, svg: element,
  spaces: () => spaces, shared: () => ({}),
});
const view = Object.create(Spaces.prototype);
view.attention = counts;
view.pressed = null;
const row = view.row({ w: { id: "branch", name: "feature", active: false }, i: 1, g: null, tree: null }, { foreground: "white", blocked: "red", accent: "blue" });
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join(" ");
assert.match(text(row), /!3/);
assert.match(text(row), /R1/);
