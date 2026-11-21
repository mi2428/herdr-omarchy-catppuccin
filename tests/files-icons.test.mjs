import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/files-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("const FILE_ICONS = ");
const end = source.indexOf("const PER_FOLDER", start);
assert.ok(start >= 0 && end > start);
const fileIcon = runInNewContext(`${source.slice(start, end)}\nfileIcon`);

assert.equal(fileIcon(".gitignore")[0], "");
assert.equal(fileIcon("README.md")[0], "󰂺");
assert.equal(fileIcon("component.TSX")[0], "");
assert.equal(fileIcon("photo.png")[0], "");
assert.equal(fileIcon("unknown.xyz")[0], "󰈙");
assert.equal(fileIcon("__proto__")[0], "󰈙");
