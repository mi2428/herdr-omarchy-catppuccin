import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/supervisor-overview/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export function entries", "function entries").replace("export default class", "class");
const entries = runInNewContext(`${source}\nentries`, { View: class {} });
const terminals = [
  { address: "t1", state: "live", labels: { "herdr.supervised": "1" } },
  { address: "t2", state: "live", labels: {} },
  { address: "t3", state: "exited", labels: { "herdr.supervised": "1" } },
  { address: "t4", state: "live", labels: { "herdr.supervised": "1", "herdr.review": "pending" } },
  { address: "t5", state: "live", labels: { "herdr.review": "pending" } },
];
const rows = entries(terminals, [{ address: "t1", status: "blocked" }, { address: "t4", status: "idle" }, { address: "t5", status: "working" }]);
assert.deepEqual(Array.from(rows, (row) => row.terminal.address), ["t4", "t1", "t5"]);
assert.equal(rows[0].review, "Review");
assert.equal(rows[1].review, null); // A blocked agent is not automatically awaiting review.
assert.equal(rows[2].review, null); // Unmarked agents cannot claim supervisor review.
const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
assert.equal(layout.children[0].children[1].children[2].content.mod, "supervisor-overview");
