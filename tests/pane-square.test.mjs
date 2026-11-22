import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/pane-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("function isColor(");
const end = source.indexOf("\nfunction icon(", start);
assert.ok(start >= 0 && end > start);
const themeColor = runInNewContext(`${source.slice(start, end)}\nthemeColor`);

assert.equal(themeColor({ dim: "#cdd6f4" }, "dim"), "#cdd6f4");
assert.throws(() => themeColor({ dim: "not-a-color" }, "dim"), /Invalid theme color: dim/);
