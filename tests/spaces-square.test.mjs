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
