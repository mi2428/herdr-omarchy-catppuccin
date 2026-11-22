import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/picker-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("function isColor(");
const end = source.indexOf("// Space colors", start);
assert.ok(start >= 0 && end > start);
const helpers = runInNewContext(`${source.slice(start, end)}\n({ isColor, color, isStringRecord, machineNames })`);

assert.equal(helpers.isColor("#abc"), true);
assert.equal(helpers.isColor("#12345678"), true);
assert.equal(helpers.isColor("red"), false);
assert.throws(() => helpers.color("#xyz"), /Invalid theme color/);
assert.equal(helpers.isStringRecord({ space: "ansi6" }), true);
assert.equal(helpers.isStringRecord({ space: 3 }), false);
assert.equal(helpers.isStringRecord([]), false);
assert.deepEqual(Array.from(helpers.machineNames(JSON.stringify({ machines: [
  { name: "local", state: "connected", temporary: false },
  { name: "legacy", state: "connected" },
  { name: "temp", state: "connected", temporary: true },
  { name: "offline", state: "offline", temporary: false },
]}))), ["local", "legacy"]);
assert.throws(() => helpers.machineNames(JSON.stringify({ machines: [{ name: "bad" }] })), /Invalid machine list/);
assert.throws(() => helpers.machineNames("{}"), /Invalid machine list/);

const Picker = runInNewContext(`${source.replace(/^import .*$/gm, "").replace("export default class Picker", "class Picker")}\nPicker`, {
  View: class {}, InputState: { new: () => ({ on() {}, focus() {}, value: () => "" }) },
  hc: async () => { throw new Error("offline"); }, agents: () => [], spaces: () => [], terminals: () => [],
  run() {}, theme: () => ({}), settings: () => ({ zoom: 1 }), props: () => ({ overlay: "test" }),
  closeOverlay() {}, openOverlay() {}, shared: () => null, setShared() {},
});
const picker = Object.create(Picker.prototype);
let worker;
let notices = 0;
const cx = {
  timer: { after() {} }, focus_handle: () => ({}), spawn: fn => { worker = fn; }, notify: () => notices++,
};
picker.init({}, cx);
await worker(cx);
assert.equal(picker.machineError, true);
assert.equal(notices, 1);
assert.deepEqual(Array.from(picker.rows(), row => row.kind), ["new", "space"]);
