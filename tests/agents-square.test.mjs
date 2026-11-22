import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/agents-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("/** @param {unknown} value @returns {value is Terminal} */");
const end = source.indexOf("\n/** @typedef {{id: string", start);
assert.ok(start >= 0 && end > start);
const isTerminal = runInNewContext(`function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }\n${source.slice(start, end)}\nisTerminal`);
assert.equal(isTerminal({ address: "t1", state: "live", status: null }), true);
