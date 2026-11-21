import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/files-square/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class Files", "class Files");
let live = true, tick, closed = 0, killed = 0;
const Files = runInNewContext(`${source}\nFiles`, {
  View: class {},
  props: () => ({}),
  terminals: () => live ? [{ address: "t1", state: "live" }] : [],
  closeOverlay: id => { assert.equal(id, "ov1"); closed++; },
  run: (name, args) => { assert.equal(name, "terminal.kill"); assert.equal(args.terminal, "t1"); killed++; },
});

const viewer = new Files();
viewer.init({ terminal: "t1", overlay: "ov1" }, { timer: { every: (ms, fn) => { assert.equal(ms, 1000); tick = fn; } } });
tick();
assert.equal(closed, 0);
viewer.close();
assert.equal(killed, 1);
live = false;
tick();
assert.equal(closed, 1);
viewer.close();
assert.equal(killed, 1);
