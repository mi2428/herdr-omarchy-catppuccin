import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/spaces-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("function isRecord(");
const end = source.indexOf("/** @param {unknown} value @returns {value is LayoutNode}", start);
assert.ok(start >= 0 && end > start);
const { machineList, liveTerminals, spaceColors, reconnectMap, foldedMachines } = runInNewContext(
  `${source.slice(start, end)}\n({ machineList, liveTerminals, spaceColors, reconnectMap, foldedMachines })`,
);

assert.deepEqual(Array.from(machineList({ machines: [{ name: "lab", target: "teo@host", state: "connected", via: false }] }), machine => machine.name), ["lab"]);
assert.throws(() => machineList({ machines: [{ name: "lab", state: "connected" }] }), /Invalid machine entry/);
assert.deepEqual(Array.from(liveTerminals([{ address: "local/t1", parent: null, state: "live", labels: null }]), terminal => terminal.address), ["local/t1"]);
assert.throws(() => liveTerminals([{ address: "t1", state: "live", labels: { bad: 1 } }]), /Invalid terminal data/);
assert.deepEqual({ ...spaceColors({ s1: "ansi6" }) }, { s1: "ansi6" });
assert.throws(() => spaceColors({ s1: null }), /Invalid shared space color/);
const saved = reconnectMap({ lab: { machine: { name: "lab", target: "teo@host", state: "connected" }, removed: false } }).lab;
assert.equal(saved.machine.target, "teo@host");
assert.equal(saved.removed, false);
assert.throws(() => reconnectMap({ lab: { machine: {}, removed: false } }), /Invalid reconnect state/);
assert.deepEqual(Array.from(foldedMachines([null, "lab"])), [null, "lab"]);
assert.throws(() => foldedMachines([1]), /Invalid folded machines/);

const element = () => {
  const node = { children: [] };
  const el = new Proxy(node, { get: (target, key) => {
    if (key in target) return target[key];
    if (key === "child") return value => { target.children.push(value); return el; };
    if (key === "when") return (yes, fn) => { if (yes) fn(el); return el; };
    if (key === "id" || key === "h" || key === "mb" || key === "right" || key === "pr" || key === "on_mouse_up") return (...args) => { target[key] = args; return el; };
    return key in target ? target[key] : () => el;
  } });
  return el;
};
const input = [
  { id: "main", name: "main", folder: "/repo", active: true, tabs: [] },
  { id: "child", name: "child", folder: "/repo/branch", active: false, tabs: [] },
];
const Spaces = runInNewContext(`${source.replace(/^import .*$/gm, "").replace(/export function /g, "function ").replace("export default class Spaces", "class Spaces")}\nSpaces`, {
  View: class {}, div: element, h_flex: element, v_flex: element, svg: element,
  spaces: () => input, panes: () => [], shared: () => ({}), machines: () => [],
});
const view = Object.create(Spaces.prototype);
const repo = JSON.stringify([null, "/repo/.git"]);
view.git = {
  [JSON.stringify([null, "/repo"])]: { name: "repo", branch: "main", ahead: 0, behind: 0, repo, linked: false },
  [JSON.stringify([null, "/repo/branch"])]: { name: "repo", branch: "qa/branch", ahead: 0, behind: 0, repo, linked: true },
};
view.shown = new Set(input.map(s => s.id));
view.foldedSpaces = new Set();
view.machines = [];
view.reconnecting = {};
view.attention = new Map();
view.pressed = null;
const find = (node, id) => node?.id?.[0] === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
let visible = view.grouped({ foreground: "white", dim: "gray", chrome: "black", selected: "blue", hover: "navy", ansi6: "teal" }, false);
assert.deepEqual(Array.from(visible, row => row.id[0]), ["space-main", "space-child"]);
assert.equal(visible[0].children[0].children.at(-1).id[0], "space-fold-main");
assert.deepEqual(visible[0].children[0].children.at(-1).right, [8]);
assert.deepEqual(visible[0].pr, [26]);
assert.deepEqual(find(visible[1], "space-child").h, [22]);
assert.deepEqual(find(visible[1], "space-child").mb, [0]);
const fold = find(visible[0], "space-fold-main");
assert.ok(fold?.on_mouse_up);
let stopped = false, notified = false;
fold.on_mouse_up[1](null, { stop_propagation: () => { stopped = true; }, notify: () => { notified = true; } });
assert.equal(stopped && notified, true);
visible = view.grouped({ foreground: "white", dim: "gray", chrome: "black", selected: "blue", hover: "navy", ansi6: "teal" }, false);
assert.deepEqual(Array.from(visible, row => row.id[0]), ["space-main"]);
assert.equal(view.activeAt, 0);
find(visible[0], "space-fold-main").on_mouse_up[1](null, { stop_propagation() {}, notify() {} });
visible = view.grouped({ foreground: "white", dim: "gray", chrome: "black", selected: "blue", hover: "navy", ansi6: "teal" }, false);
assert.deepEqual(Array.from(visible, row => row.id[0]), ["space-main", "space-child"]);
