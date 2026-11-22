import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/agents-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("/** @param {unknown} value @returns {value is Terminal} */");
const end = source.indexOf("\n/** @typedef {{id: string", start);
assert.ok(start >= 0 && end > start);
const isTerminal = runInNewContext(`function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }\n${source.slice(start, end)}\nisTerminal`);
assert.equal(isTerminal({ address: "t1", state: "live", status: null }), true);
assert.equal(isTerminal({ address: "t1", state: "live", cwd: "/repo" }), true);
assert.equal(isTerminal({ address: "t1", state: "live", cwd: 7 }), false);

const Agents = runInNewContext(`${source.replace(/^import .*$/gm, "").replace(/export function /g, "function ").replace("export default class Agents", "class Agents")}\nAgents`, { View: class {} });
const view = Object.create(Agents.prototype);
view.agentPanes = new Map([["parent", { cwd: "/repo", branch: "qa/parser" }], ["own", { cwd: "/own", branch: "qa/own" }]]);
const rows = view.tree([
  { address: "child", parent: "parent", cwd: "/repo", state: "live" },
  { address: "grandchild", parent: "child", cwd: "/repo", state: "live" },
  { address: "own", parent: "parent", cwd: "/own", state: "live" },
  { address: "elsewhere", parent: "parent", cwd: "/different", state: "live" },
], "parent");
assert.deepEqual(Array.from(rows, row => [row.t.address, row.depth, row.branch]), [
  ["child", 1, "qa/parser"], ["grandchild", 2, "qa/parser"],
  ["own", 1, "qa/own"], ["elsewhere", 1, null],
]);
